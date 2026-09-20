"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Check,
  Folder,
  FolderInput,
  FolderOutput,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import {
  SidebarInput,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DownloadMenu } from "./DownloadMenu";
import type { FolderSummary } from "@/lib/types";
import type { ConversationSummary } from "./ConversationList";

export const CANVAS_DRAG_TYPE = "application/x-splat-canvas";

export function CanvasItem({
  conversation: c,
  folders,
  onRename,
  onMove,
  onShare,
  onDelete,
}: {
  conversation: ConversationSummary;
  folders: FolderSummary[];
  onRename: (conversation: ConversationSummary, title: string) => void;
  onMove: (conversation: ConversationSummary, folderId: string | null) => void;
  onShare: (conversation: ConversationSummary) => void;
  onDelete: (conversation: ConversationSummary) => void;
}) {
  const pathname = usePathname();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  function startRename() {
    setDraft(c.title);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    const title = draft.trim();
    if (!title || title === c.title) return;
    onRename(c, title);
  }

  if (renaming) {
    return (
      <SidebarMenuItem>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <SidebarInput
            autoFocus
            maxLength={120}
            aria-label="Canvas title"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        </form>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CANVAS_DRAG_TYPE, c.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <SidebarMenuButton
        isActive={pathname === `/c/${c.id}`}
        className="pr-8"
        render={<Link href={`/c/${c.id}`} />}
      >
        <MessageSquare className="size-4" />
        <span className="truncate">{c.title}</span>
        {c.share_token && (
          <Link2
            className="ml-auto size-3.5 shrink-0 text-muted-foreground"
            aria-label="Shared with a link"
          />
        )}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover title="More" />}
        >
          <MoreHorizontal />
          <span className="sr-only">Canvas options</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-40"
          finalFocus={false}
        >
          <DropdownMenuItem onClick={startRename}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="size-4" />
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {folders.length === 0 && (
                <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
              )}
              {folders.map((folder) => {
                const current = folder.id === c.folder_id;
                return (
                  <DropdownMenuItem
                    key={folder.id}
                    disabled={current}
                    onClick={() => onMove(c, folder.id)}
                  >
                    <Folder className="size-4 fill-muted-foreground/40 text-muted-foreground" />
                    <span className="truncate">{folder.name}</span>
                    {current && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                );
              })}
              {c.folder_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onMove(c, null)}>
                    <FolderOutput className="size-4" />
                    Take out of folder
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => onShare(c)}>
            <Share2 className="size-4" />
            {c.share_token ? "Share link" : "Share"}
          </DropdownMenuItem>
          <DownloadMenu conversationId={c.id} />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(c)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
