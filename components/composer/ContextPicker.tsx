"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { AttachmentIcon } from "@/components/attachments/AttachmentIcon";
import { missingTextNotice } from "@/lib/attachments/types";
import { useGraphStore } from "@/lib/store/graph-store";
import { ancestorsOf } from "@/lib/graph/ancestors";
import { topoOrder } from "@/lib/graph/topo-order";
import { estimateTokens, formatTokens } from "@/lib/tokens";
import type { CardAttachment, CardNode } from "@/lib/types";

export function ContextPicker({
  parent,
  checked,
  onToggle,
  checkedAttachments,
  onToggleAttachment,
  open,
  onOpenChange,
}: {
  parent: CardNode;
  checked: Record<string, boolean>;
  onToggle: (nodeId: string, value: boolean) => void;
  checkedAttachments: Record<string, boolean>;
  onToggleAttachment: (attachmentId: string, value: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const attachments = useGraphStore((s) => s.attachments);

  const orderedAncestors = useMemo(() => {
    const all = Object.values(nodes);
    const ids = ancestorsOf(parent.id, all, edges);
    ids.add(parent.id);
    return topoOrder([...ids], all, edges);
  }, [parent.id, nodes, edges]);

  const totalTokens = orderedAncestors.reduce((sum, id) => {
    const node = nodes[id];
    if (!node) return sum;
    const cardTokens = checked[id]
      ? estimateTokens(node.prompt + node.response)
      : 0;
    const attachmentTokens = (attachments[id] ?? []).reduce(
      (n, a) => n + (checkedAttachments[a.id] ? a.est_tokens : 0),
      0,
    );
    return sum + cardTokens + attachmentTokens;
  }, 0);

  const checkedCards = orderedAncestors.filter((id) => checked[id]).length;
  // Files are counted too: a card can be unticked while the file it carries
  // still goes with the prompt, and the summary is all there is to read while
  // the list is folded.
  const checkedFiles = orderedAncestors.reduce(
    (n, id) =>
      n + (attachments[id] ?? []).filter((a) => checkedAttachments[a.id]).length,
    0,
  );

  return (
    <div className="rounded-md border bg-muted/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span>Context</span>
        <span className="truncate font-normal">
          — {checkedCards} card{checkedCards === 1 ? "" : "s"}
          {checkedFiles > 0 &&
            ` · ${checkedFiles} file${checkedFiles === 1 ? "" : "s"}`}{" "}
          sent with this prompt
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          ~{formatTokens(totalTokens)} tok
        </span>
      </button>
      {!open ? null : (
    <div className="max-h-64 space-y-1 overflow-y-auto border-t p-2">
      {orderedAncestors.map((id) => {
        const n = nodes[id];
        if (!n) return null;
        return (
          <div key={id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/60">
              <Checkbox
                checked={checked[id] ?? false}
                onCheckedChange={(value) => onToggle(id, value === true)}
              />
              <span className="flex-1 truncate">
                {n.title ?? n.prompt}
                {id === parent.id && (
                  <span className="ml-1 text-muted-foreground">(parent)</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                ~{formatTokens(estimateTokens(n.prompt + n.response))} tok
              </span>
            </label>
            {(attachments[id] ?? []).map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                checked={checkedAttachments[attachment.id] ?? false}
                onToggle={onToggleAttachment}
              />
            ))}
          </div>
        );
      })}
      <div className="flex justify-between border-t px-1 pt-1 text-[11px] font-medium">
        <span>Total</span>
        <span className="tabular-nums">~{formatTokens(totalTokens)} tok</span>
      </div>
    </div>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  checked,
  onToggle,
}: {
  attachment: CardAttachment;
  checked: boolean;
  onToggle: (attachmentId: string, value: boolean) => void;
}) {
  const notice = missingTextNotice(attachment);

  return (
    <label
      title={notice?.title ?? `Send ${attachment.filename} again with this prompt`}
      className="flex cursor-pointer items-center gap-2 rounded py-0.5 pr-1 pl-6 text-xs hover:bg-accent/60"
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onToggle(attachment.id, value === true)}
      />
      <AttachmentIcon
        kind={attachment.kind}
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-muted-foreground">
        {attachment.filename}
        {attachment.truncated && (
          <span className="ml-1 text-[10px]">(truncated)</span>
        )}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {notice?.short ?? `~${formatTokens(attachment.est_tokens)} tok`}
      </span>
    </label>
  );
}
