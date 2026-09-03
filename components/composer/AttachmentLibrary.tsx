"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentIcon } from "@/components/attachments/AttachmentIcon";
import { fetchAttachmentLibrary } from "@/lib/attachments-client";
import { formatBytes, missingTextNotice } from "@/lib/attachments/types";
import { queryKeys } from "@/lib/query/keys";
import { useAttachmentStore } from "@/lib/store/attachment-store";
import { formatTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import type { LibraryAttachment } from "@/lib/types";

function ageOf(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function AttachmentLibrary({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // The dialog stays mounted, so each opening starts from a clean selection.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setPicked({});
    }
  }

  const attached = useAttachmentStore((s) => s.drafts);
  const attachedSources = useMemo(
    () => new Set(attached.map((d) => d.sourceId).filter((id) => id !== null)),
    [attached],
  );

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.attachmentLibrary(),
    queryFn: fetchAttachmentLibrary,
    enabled: open,
    // A file sent a moment ago belongs in the list the next time it opens.
    staleTime: 0,
  });

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter(
      (item) =>
        item.filename.toLowerCase().includes(needle) ||
        item.conversation_title?.toLowerCase().includes(needle),
    );
  }, [data, query]);

  const selected = useMemo(
    () => matches.filter((item) => picked[item.id]),
    [matches, picked],
  );

  function attach() {
    useAttachmentStore.getState().reuse(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach an earlier file</DialogTitle>
          <DialogDescription>
            Files you have already sent, newest first. Picking one copies it
            into this canvas — nothing is uploaded again.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by file or canvas name"
          autoComplete="off"
        />

        <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
          {isPending ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Could not load your files.
            </p>
          ) : matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {data && data.length > 0
                ? "No file matches that."
                : "Nothing here yet — a file shows up once you have sent it with a prompt."}
            </p>
          ) : (
            matches.map((item) => (
              <Row
                key={item.id}
                item={item}
                checked={picked[item.id] ?? false}
                disabled={attachedSources.has(item.id)}
                onToggle={(value) =>
                  setPicked((prev) => ({ ...prev, [item.id]: value }))
                }
              />
            ))
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button disabled={selected.length === 0} onClick={attach}>
            Attach
            {selected.length > 0 && ` ${selected.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: LibraryAttachment;
  checked: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  const notice = missingTextNotice(item);

  return (
    <label
      title={notice?.title ?? item.filename}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        disabled ? "opacity-50" : "cursor-pointer hover:bg-accent/60",
      )}
    >
      <Checkbox
        checked={checked || disabled}
        disabled={disabled}
        onCheckedChange={(value) => onToggle(value === true)}
      />
      <AttachmentIcon
        kind={item.kind}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.filename}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {disabled
            ? "already attached"
            : `${item.conversation_title ?? "Untitled"} · ${ageOf(item.created_at)}`}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          notice ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {notice?.short ??
          `${formatBytes(item.byte_size)} · ~${formatTokens(item.est_tokens)} tok`}
      </span>
    </label>
  );
}
