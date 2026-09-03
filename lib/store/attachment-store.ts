"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  UploadAbortedError,
  createConversation,
  deleteAttachment,
  downscaleImage,
  isResizable,
  nameForPastedFile,
  reuseAttachments,
  uploadAttachment,
} from "@/lib/attachments-client";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import {
  MAX_ATTACHMENTS_PER_TURN,
  SIZE_CAPS,
  classify,
  sizeCapMessage,
} from "@/lib/attachments/types";
import type { CardAttachment, LibraryAttachment } from "@/lib/types";

export type DraftAttachment = {
  localId: string;
  filename: string;
  // The library row this draft was copied from, null when it came off the disk.
  sourceId: string | null;
  status: "uploading" | "ready" | "error";
  progress: number;
  error: string | null;
  attachment: CardAttachment | null;
};

type AttachmentState = {
  drafts: DraftAttachment[];
  enqueue(files: File[], options?: { synthesiseNames?: boolean }): void;
  reuse(items: LibraryAttachment[]): void;
  remove(localId: string): void;
  released(sentAttachmentIds: string[]): void;
  reset(): void;
};

const aborts = new Map<string, () => void>();

// Memoised so a multi-file drop onto the draft canvas creates one conversation
// rather than one per file.
let creating: Promise<string> | null = null;

function ensureConversation(): Promise<string> {
  const existing = useGraphStore.getState().conversationId;
  if (existing) return Promise.resolve(existing);
  creating ??= createConversation()
    .then((id) => {
      useGraphStore.getState().adoptConversation(id);
      return id;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

function localId(): string {
  return crypto.randomUUID();
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  drafts: [],

  enqueue(files, options) {
    if (files.length === 0) return;

    // The composer hides its own controls during a regeneration; this catches
    // the canvas drop, which does not go through them.
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

      const classification = classify(named.name, named.type);
      if (!classification.ok) {
        toast.error(classification.message);
        continue;
      }
      if (named.size === 0) {
        toast.error(`${named.name} is empty.`);
        continue;
      }
      // Only files nothing can shrink are capped here; the rest are checked in
      // start(), after the downscaler has run.
      const cap = SIZE_CAPS[classification.kind];
      if (!isResizable(named) && named.size > cap) {
        toast.error(`${named.name} is ${sizeCapMessage(named.size, cap)}`);
        continue;
      }

      const id = localId();
      set((state) => ({
        drafts: [
          ...state.drafts,
          {
            localId: id,
            filename: named.name,
            sourceId: null,
            status: "uploading",
            progress: 0,
            error: null,
            attachment: null,
          },
        ],
      }));

      void start(id, named, cap);
    }
  },

  reuse(items) {
    if (items.length === 0) return;

    if (useComposerStore.getState().regenerateNodeId) {
      toast.error("Finish or cancel the regeneration before attaching a file.");
      return;
    }

    const already = new Set(
      get().drafts.map((d) => d.sourceId).filter((id) => id !== null),
    );
    const fresh = items.filter((item) => !already.has(item.id));
    if (fresh.length === 0) return;

    const room = MAX_ATTACHMENTS_PER_TURN - get().drafts.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_TURN} files.`);
      return;
    }
    const accepted = fresh.slice(0, room);
    if (accepted.length < fresh.length) {
      toast.error(`Only the first ${room} of those files were attached.`);
    }

    const entries = accepted.map((item) => ({ localId: localId(), item }));
    set((state) => ({
      drafts: [
        ...state.drafts,
        ...entries.map(({ localId: id, item }) => ({
          localId: id,
          filename: item.filename,
          sourceId: item.id,
          status: "uploading" as const,
          progress: 0,
          error: null,
          attachment: null,
        })),
      ],
    }));

    void copy(entries);
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

function patch(id: string, fields: Partial<DraftAttachment>): void {
  useAttachmentStore.setState((state) => ({
    drafts: state.drafts.map((d) =>
      d.localId === id ? { ...d, ...fields } : d,
    ),
  }));
}

function live(id: string): boolean {
  return useAttachmentStore.getState().drafts.some((d) => d.localId === id);
}

async function start(id: string, file: File, cap: number): Promise<void> {
  const prepared = await downscaleImage(file);
  // A cancel during the resize already dropped the row; uploading now would
  // orphan the object.
  if (!live(id)) return;

  if (prepared.size > cap) {
    patch(id, {
      status: "error",
      error: sizeCapMessage(prepared.size, cap),
    });
    return;
  }

  let conversationId: string;
  try {
    conversationId = await ensureConversation();
  } catch (err) {
    patch(id, {
      status: "error",
      error: err instanceof Error ? err.message : "Could not start a conversation",
    });
    return;
  }
  if (!live(id)) return;

  const upload = uploadAttachment({
    file: prepared,
    conversationId,
    onProgress: (progress) => patch(id, { progress }),
  });
  aborts.set(id, upload.abort);

  try {
    const attachment = await upload.promise;
    patch(id, { status: "ready", progress: 1, attachment });
  } catch (err) {
    if (err instanceof UploadAbortedError) return;
    patch(id, {
      status: "error",
      error: err instanceof Error ? err.message : "Upload failed",
    });
  } finally {
    aborts.delete(id);
  }
}

// One request for the batch: the bytes are copied inside the bucket, so there is
// no per-file progress to report and nothing to abort part-way.
async function copy(
  entries: { localId: string; item: LibraryAttachment }[],
): Promise<void> {
  let conversationId: string;
  try {
    conversationId = await ensureConversation();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not start a conversation";
    for (const entry of entries) {
      patch(entry.localId, { status: "error", error: message });
    }
    return;
  }

  const wanted = entries.filter((entry) => live(entry.localId));
  if (wanted.length === 0) return;

  try {
    const copies = await reuseAttachments(
      conversationId,
      wanted.map((entry) => entry.item.id),
    );
    copies.forEach((attachment, index) => {
      const id = wanted[index].localId;
      // Removed while the copy was in flight: the new row is a draft nothing
      // points at, so it goes back out rather than waiting for the sweep.
      if (!live(id)) {
        void deleteAttachment(attachment.id).catch(() => {});
        return;
      }
      patch(id, { status: "ready", progress: 1, attachment });
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not attach that file";
    for (const entry of wanted) {
      patch(entry.localId, { status: "error", error: message });
    }
  }
}

export function readyAttachmentIds(drafts: DraftAttachment[]): string[] {
  return drafts
    .filter((d) => d.status === "ready" && d.attachment)
    .map((d) => d.attachment!.id);
}
