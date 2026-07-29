"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { AttachmentIcon } from "@/components/attachments/AttachmentIcon";
import { fetchAttachmentUrls } from "@/lib/attachments-client";
import {
  SIGNED_URL_TTL_SECONDS,
  formatBytes,
  missingTextNotice,
} from "@/lib/attachments/types";
import { queryKeys } from "@/lib/query/keys";
import { useGraphStore } from "@/lib/store/graph-store";
import { formatTokens } from "@/lib/tokens";
import type { CardAttachment } from "@/lib/types";

function describe(attachment: CardAttachment): string {
  return (
    missingTextNotice(attachment)?.short ??
    `${formatBytes(attachment.byte_size)} · ~${formatTokens(attachment.est_tokens)} tok${
      attachment.truncated ? " · truncated" : ""
    }`
  );
}

export function CardAttachmentList({
  attachments,
}: {
  attachments: CardAttachment[];
}) {
  const readOnly = useGraphStore((s) => s.readOnly);
  const ids = attachments.map((a) => a.id);

  const { data: urls } = useQuery({
    queryKey: queryKeys.attachmentUrls(ids),
    queryFn: () => fetchAttachmentUrls(ids),
    enabled: !readOnly && ids.length > 0,
    staleTime: SIGNED_URL_TTL_SECONDS * 1000 * 0.75,
    retry: false,
  });

  if (attachments.length === 0) return null;

  return (
    <div className="space-y-1">
      {attachments.map((attachment) => {
        const url = urls?.[attachment.id];
        return (
          <div
            key={attachment.id}
            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          >
            {attachment.kind === "image" && url ? (
              // next/image would want a remote pattern for a host that changes
              // per project.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={attachment.filename}
                className="size-8 shrink-0 rounded border object-cover"
              />
            ) : (
              <AttachmentIcon
                kind={attachment.kind}
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {attachment.filename}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {describe(attachment)}
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`Open ${attachment.filename}`}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
                <span className="sr-only">Open {attachment.filename}</span>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
