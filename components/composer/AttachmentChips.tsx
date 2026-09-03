"use client";

import { Loader2, X } from "lucide-react";
import { AttachmentIcon } from "@/components/attachments/AttachmentIcon";
import { missingTextNotice } from "@/lib/attachments/types";
import { useAttachmentStore, type DraftAttachment } from "@/lib/store/attachment-store";
import { formatTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";

type Detail = { text: string; title: string; warn: boolean };

function detailOf(draft: DraftAttachment): Detail {
  if (draft.status === "uploading") {
    // A reused file is copied inside the bucket, so there is no percentage to
    // count up to.
    return draft.sourceId
      ? { text: "attaching…", title: "Attaching a file you uploaded before", warn: false }
      : {
          text: `${Math.round(draft.progress * 100)}%`,
          title: "Uploading…",
          warn: false,
        };
  }
  if (draft.status === "error" || !draft.attachment) {
    const message = draft.error ?? "Upload failed";
    return { text: "failed", title: message, warn: true };
  }

  const notice = missingTextNotice(draft.attachment);
  if (notice) {
    return { text: notice.short, title: notice.title, warn: true };
  }

  const { est_tokens, truncated } = draft.attachment;
  return {
    text: `~${formatTokens(est_tokens)} tok${truncated ? " · cut" : ""}`,
    title: truncated
      ? "Only the first 400,000 characters of this file are sent."
      : "Estimated tokens this file adds to the prompt",
    warn: false,
  };
}

export function AttachmentChips() {
  const drafts = useAttachmentStore((s) => s.drafts);
  const remove = useAttachmentStore((s) => s.remove);

  if (drafts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {drafts.map((draft) => {
        const detail = detailOf(draft);
        return (
          <span
            key={draft.localId}
            title={`${draft.filename} — ${detail.title}`}
            className={cn(
              "relative flex max-w-56 items-center gap-1.5 overflow-hidden rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-[11px]",
              detail.warn && "border-destructive/50",
            )}
          >
            {draft.status === "uploading" ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <AttachmentIcon
                kind={draft.attachment?.kind ?? "text"}
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
            <span className="truncate">{draft.filename}</span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                detail.warn ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {detail.text}
            </span>
            <button
              type="button"
              title="Remove this file"
              onClick={() => remove(draft.localId)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
              <span className="sr-only">Remove {draft.filename}</span>
            </button>
            {draft.status === "uploading" && !draft.sourceId && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/60 transition-[width]"
                style={{ width: `${Math.round(draft.progress * 100)}%` }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
