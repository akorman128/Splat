"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  UploadAbortedError,
  deleteAttachment,
  downscaleImage,
  nameForPastedFile,
  uploadAttachment,
} from "@/lib/attachments-client";
import { useGraphStore } from "@/lib/store/graph-store";
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
  // After a send: the rows now belong to a card, so the composer just lets go.
  released(): void;
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

    const room = MAX_ATTACHMENTS_PER_TURN - get().drafts.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_TURN} files.`);
      return;
    }
    const accepted = files.slice(0, room);
    if (accepted.length < files.length) {
      toast.error(`Only the first ${room} of those files were attached.`);
    }

    for (const [index, original] of accepted.entries()) {
      const named =
        options?.synthesiseNames || !original.name
          ? new File([original], nameForPastedFile(original, index), {
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
      const cap = SIZE_CAPS[classification.kind];
      if (named.size > cap) {
        toast.error(
          `${named.name} is ${formatBytes(named.size)} — the limit for this kind of file is ${formatBytes(cap)}.`,
        );
        continue;
      }
      if (named.size === 0) {
        toast.error(`${named.name} is empty.`);
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

      void start(id, named, conversationId, set);
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

  released() {
    aborts.clear();
    set({ drafts: [] });
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
