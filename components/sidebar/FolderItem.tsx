"use client";

import { startTransition, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarInput,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { renameFolder } from "@/app/(app)/folders/actions";
import { MAX_FOLDER_NAME_LENGTH, type FolderSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CANVAS_DRAG_TYPE } from "./CanvasItem";

export function FolderItem({
  folder,
  open,
  onOpenChange,
  onDelete,
  onDropCanvas,
  empty,
  children,
}: {
  folder: FolderSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (folder: FolderSummary) => void;
  onDropCanvas: (folderId: string, canvasId: string) => void;
  empty: boolean;
  children: React.ReactNode;
}) {
  const [name, showName] = useOptimistic(folder.name);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // dragleave fires for every child crossed on the way to the drop, so the
  // highlight tracks nesting depth rather than the last event.
  const dragDepth = useRef(0);

  function startRename() {
    setDraft(folder.name);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === folder.name) return;
    startTransition(async () => {
      showName(next);
      try {
        await renameFolder(folder.id, next);
      } catch (error) {
        toast.error("Could not rename folder", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function carriesCanvas(event: React.DragEvent) {
    return event.dataTransfer.types.includes(CANVAS_DRAG_TYPE);
  }

  return (
    <SidebarMenuItem
      onDragEnter={(event) => {
        if (!carriesCanvas(event)) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!carriesCanvas(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event) => {
        if (!carriesCanvas(event)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (!carriesCanvas(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        onDropCanvas(folder.id, event.dataTransfer.getData(CANVAS_DRAG_TYPE));
      }}
    >
      <Collapsible
        open={open}
        onOpenChange={onOpenChange}
        className="group/collapsible"
      >
        {renaming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <SidebarInput
              autoFocus
              maxLength={MAX_FOLDER_NAME_LENGTH}
              aria-label="Folder name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(false);
              }}
            />
          </form>
        ) : (
          <>
            <CollapsibleTrigger
              render={
                <SidebarMenuButton
                  className={cn(
                    "pr-8",
                    dragOver &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                />
              }
            >
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-open/collapsible:rotate-90" />
              <Folder className="size-4 fill-muted-foreground/40 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </CollapsibleTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuAction showOnHover title="More" />}
              >
                <MoreHorizontal />
                <span className="sr-only">Folder options</span>
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
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(folder)}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {!empty && (
          <CollapsibleContent>
            <SidebarMenuSub className="mr-0 pr-0">{children}</SidebarMenuSub>
          </CollapsibleContent>
        )}
      </Collapsible>
    </SidebarMenuItem>
  );
}
