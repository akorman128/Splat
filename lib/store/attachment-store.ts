"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  UploadAbortedError,
  deleteAttachment,
  downscaleImage,
  isResizable,
  nameForPastedFile,
  uploadAttachment,
} from "@/lib/attachments-client";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import {
  MAX_ATTACHMENTS_PER_TURN,
  SIZE_CAPS,
  classify,
  formatBytes,
} from "@/lib/attachments/types";
import type { CardAttachment } from "@/lib/types";

// A draft attachment — uploaded, extracted, but not yet claimed by a card. It
// is deliberately not in the context picker: a chip in the composer *is* a
// checked attachment, which is how "checked on the turn it is attached,
// unchecked forever after" ends up needing no state at all.
export type DraftAttachment = {
  localId: string;
  filename: string;
  byteSize: number;
  status: "uploading" | "ready" | "error";
  progress: number;
  error: string | null;
  attachment: CardAttachment | null;
};

type AttachmentState = {
  drafts: DraftAttachment[];
  enqueue(files: File[], options?: { synthesiseNames?: boolean }): void;
  remove(localId: string): void;
  // After a send: the rows named here now belong to a card, so the composer
  // lets go of them. Anything not on the list — an upload that started while
  // the card was streaming — stays, because dropping it here would leave the
  // object in the bucket with no chip and no owner.
  released(sentAttachmentIds: string[]): void;
  // On leaving a conversation: in-flight uploads are pointless, and whatever
  // landed becomes an abandoned draft for the sweep to reclaim.
  reset(): void;
};

const aborts = new Map<string, () => void>();

function localId(): string {
  return crypto.randomUUID();
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  drafts: [],

  enqueue(files, options) {
    const conversationId = useGraphStore.getState().conversationId;
    if (!conversationId || files.length === 0) return;

    // A regeneration replays the card's own files and has no way to send new
    // ones, so anything accepted here would upload and then strand. The
    // composer hides its own controls; this catches the canvas drop, which
    // does not go through them.
    if (useComposerStore.getState().regenerateNodeId) {
      toast.error(
        "Finish or cancel the regeneration before attaching a file.",
      );
      return;
    }

    const room = MAX_ATTACHMENTS_PER_TURN - get().drafts.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_TURN} files.`);
      return;
    }
    const accepted = files.slice(0, room);
    if (accepted.length < files.length) {
      toast.error(`Only the first ${room} of those files were attached.`);
    }

    for (const original of accepted) {
      const named =
        options?.synthesiseNames || !original.name
          ? new File([original], nameForPastedFile(original), {
              type: original.type,
            })
          : original;

      // The same call the route makes. Rejecting here saves a round trip and
      // gives the reason instantly; the server repeats it because a check in
      // the browser is a courtesy, not a gate.
      const classification = classify(named.name, named.type);
      if (!classification.ok) {
        toast.error(classification.message);
        continue;
      }
      if (named.size === 0) {
        toast.error(`${named.name} is empty.`);
        continue;
      }
      // The cap is only applied here to files nothing can shrink. A 12MP
      // camera photo is over the 8MB image cap and lands well under 1MB once
      // downscaled, so rejecting it before the downscaler has run would be
      // refusing a file we were about to make acceptable; that check moves
      // into start(), after the resize.
      const cap = SIZE_CAPS[classification.kind];
      if (!isResizable(named) && named.size > cap) {
        toast.error(
          `${named.name} is ${formatBytes(named.size)} — the limit for this kind of file is ${formatBytes(cap)}.`,
        );
        continue;
      }

      const id = localId();
      set((state) => ({
        drafts: [
          ...state.drafts,
          {
            localId: id,
            filename: named.name,
            byteSize: named.size,
            status: "uploading",
            progress: 0,
            error: null,
            attachment: null,
          },
        ],
      }));

      void start(id, named, cap, conversationId, set);
    }
  },

  remove(id) {
    const draft = get().drafts.find((d) => d.localId === id);
    aborts.get(id)?.();
    aborts.delete(id);
    set((state) => ({
      drafts: state.drafts.filter((d) => d.localId !== id),
    }));
    if (draft?.attachment) {
      deleteAttachment(draft.attachment.id).catch((error: Error) =>
        toast.error("Could not remove the file", {
          description: error.message,
        }),
      );
    }
  },

  released(sentAttachmentIds) {
    const sent = new Set(sentAttachmentIds);
    set((state) => ({
      drafts: state.drafts.filter(
        (d) => !(d.attachment && sent.has(d.attachment.id)),
      ),
    }));
  },

  reset() {
    for (const abort of aborts.values()) abort();
    aborts.clear();
    set({ drafts: [] });
  },
}));

type Setter = (
  updater: (state: AttachmentState) => Partial<AttachmentState>,
) => void;

function patch(
  set: Setter,
  id: string,
  fields: Partial<DraftAttachment>,
): void {
  set((state) => ({
    drafts: state.drafts.map((d) =>
      d.localId === id ? { ...d, ...fields } : d,
    ),
  }));
}

async function start(
  id: string,
  file: File,
  cap: number,
  conversationId: string,
  set: Setter,
): Promise<void> {
  const prepared = await downscaleImage(file);
  // A cancel that lands while the image is being resized has already dropped
  // the row from the list; starting the request now would orphan an object.
  if (!useAttachmentStore.getState().drafts.some((d) => d.localId === id)) {
    return;
  }
  patch(set, id, { byteSize: prepared.size });

  // Still too big with the pixels already thrown away — an error on the chip
  // rather than a toast, because by now the file is on screen.
  if (prepared.size > cap) {
    patch(set, id, {
      status: "error",
      error: `${formatBytes(prepared.size)} — the limit for this kind of file is ${formatBytes(cap)}.`,
    });
    return;
  }

  const upload = uploadAttachment({
    file: prepared,
    conversationId,
    onProgress: (progress) => patch(set, id, { progress }),
  });
  aborts.set(id, upload.abort);

  try {
    const attachment = await upload.promise;
    patch(set, id, { status: "ready", progress: 1, attachment });
  } catch (err) {
    if (err instanceof UploadAbortedError) return;
    patch(set, id, {
      status: "error",
      error: err instanceof Error ? err.message : "Upload failed",
    });
  } finally {
    aborts.delete(id);
  }
}

export function readyAttachmentIds(drafts: DraftAttachment[]): string[] {
  return drafts
    .filter((d) => d.status === "ready" && d.attachment)
    .map((d) => d.attachment!.id);
}
