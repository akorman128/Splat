"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { startTransition, useEffect, useOptimistic, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentObjectPaths,
  removeAttachmentObjects,
} from "@/lib/attachments-client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeMenu } from "@/components/theme-menu";
import { SkillDialog, type SkillTarget } from "@/components/skills/SkillDialog";
import { createFolder, deleteFolder } from "@/app/(app)/folders/actions";
import {
  SKILLS_SECTION,
  persistCollapsedSections,
} from "@/lib/sidebar-sections";
import { CanvasItem } from "./CanvasItem";
import { FolderItem } from "./FolderItem";
import { ShareDialog } from "./ShareDialog";
import {
  MAX_FOLDER_NAME_LENGTH,
  type FolderSummary,
  type SkillSummary,
} from "@/lib/types";
import {
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  LogOut,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
  share_token: string | null;
  folder_id: string | null;
};

export function AppSidebar({
  conversations,
  folders,
  skills,
  collapsed,
  email,
}: {
  conversations: ConversationSummary[];
  folders: FolderSummary[];
  skills: SkillSummary[];
  collapsed: string[];
  email: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [skillTarget, setSkillTarget] = useState<SkillTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [shareTarget, setShareTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<FolderSummary | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [collapsedSections, setCollapsedSections] = useState(
    () => new Set(collapsed),
  );
  const [shown, applyUpdate] = useOptimistic(
    conversations,
    (list: ConversationSummary[], updated: ConversationSummary) =>
      list.map((c) => (c.id === updated.id ? updated : c)),
  );

  const folderIds = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, ConversationSummary[]>();
  const unfiled: ConversationSummary[] = [];
  for (const c of shown) {
    if (c.folder_id && folderIds.has(c.folder_id)) {
      byFolder.set(c.folder_id, [...(byFolder.get(c.folder_id) ?? []), c]);
    } else {
      unfiled.push(c);
    }
  }

  // A dialog owns the screen while it is open, so leave the keys to it rather
  // than routing or opening a second one behind it.
  const dialogOpen =
    skillTarget !== null ||
    shareTarget !== null ||
    pendingDelete !== null ||
    pendingFolderDelete !== null;

  useEffect(() => {
    if (dialogOpen) return;

    function handle(event: KeyboardEvent) {
      if (!event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "n" && key !== "s") return;

      event.preventDefault();
      if (key === "n") {
        router.push("/c/new");
      } else {
        setSkillTarget({ kind: "new" });
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [dialogOpen, router]);

  function setSectionCollapsed(key: string, isCollapsed: boolean) {
    const next = new Set(collapsedSections);
    if (isCollapsed) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setCollapsedSections(next);
    persistCollapsedSections(
      [...next].filter((k) => k === SKILLS_SECTION || folderIds.has(k)),
    );
  }

  async function deleteConversation() {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = createClient();
    const paths = await attachmentObjectPaths({
      conversationId: pendingDelete.id,
    });
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast.error("Could not delete canvas", {
        description: error.message,
      });
      return;
    }
    await removeAttachmentObjects(paths);
    const wasOpen = pathname === `/c/${pendingDelete.id}`;
    setPendingDelete(null);
    if (wasOpen) router.push("/c");
    router.refresh();
  }

  function renameConversation(c: ConversationSummary, title: string) {
    startTransition(async () => {
      applyUpdate({ ...c, title });
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ title })
        .eq("id", c.id);
      if (error) {
        toast.error("Could not rename canvas", {
          description: error.message,
        });
        return;
      }
      router.refresh();
    });
  }

  function moveConversation(c: ConversationSummary, folderId: string | null) {
    if (folderId) setSectionCollapsed(folderId, false);
    startTransition(async () => {
      applyUpdate({ ...c, folder_id: folderId });
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ folder_id: folderId })
        .eq("id", c.id);
      if (error) {
        toast.error("Could not move canvas", {
          description: error.message,
        });
        return;
      }
      router.refresh();
    });
  }

  function dropCanvasIntoFolder(folderId: string, canvasId: string) {
    const c = shown.find((item) => item.id === canvasId);
    if (c && c.folder_id !== folderId) moveConversation(c, folderId);
  }

  function commitNewFolder() {
    const name = folderDraft.trim();
    setCreatingFolder(false);
    if (!name) return;
    startTransition(async () => {
      try {
        await createFolder(name);
      } catch (error) {
        toast.error("Could not create folder", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  async function removeFolder() {
    if (!pendingFolderDelete) return;
    setDeletingFolder(true);
    try {
      await deleteFolder(pendingFolderDelete.id);
      setPendingFolderDelete(null);
    } catch (error) {
      toast.error("Could not delete folder", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeletingFolder(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  function renderCanvas(c: ConversationSummary) {
    return (
      <CanvasItem
        key={c.id}
        conversation={c}
        folders={folders}
        onRename={renameConversation}
        onMove={moveConversation}
        onShare={setShareTarget}
        onDelete={setPendingDelete}
      />
    );
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 pt-1">
          <Link
            href="/c/new"
            className="rounded-sm text-lg font-semibold tracking-tight transition-opacity outline-none hover:opacity-70 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            🫟 Splat
          </Link>
        </div>
        <Button
          size="lg"
          className="mx-2 mb-1"
          nativeButton={false}
          render={<Link href="/c/new" />}
        >
          <Plus className="size-4" />
          New canvas
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <Collapsible
          open={!collapsedSections.has(SKILLS_SECTION)}
          onOpenChange={(open) => setSectionCollapsed(SKILLS_SECTION, !open)}
          className="group/collapsible"
          render={<SidebarGroup />}
        >
          <SidebarGroupLabel
            render={<CollapsibleTrigger />}
            className="w-full gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-open/collapsible:rotate-90" />
            Skills
          </SidebarGroupLabel>
          <SidebarGroupAction
            title="New skill"
            onClick={() => setSkillTarget({ kind: "new" })}
          >
            <Plus />
            <span className="sr-only">New skill</span>
          </SidebarGroupAction>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                {skills.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No skills yet — save one to reuse it with{" "}
                    <span className="font-mono">/</span>.
                  </p>
                )}
                {skills.map((skill) => (
                  <SidebarMenuItem key={skill.id}>
                    <SidebarMenuButton
                      isActive={
                        skillTarget?.kind === "edit" &&
                        skillTarget.skillId === skill.id
                      }
                      onClick={() =>
                        setSkillTarget({ kind: "edit", skillId: skill.id })
                      }
                    >
                      <Sparkles className="size-4" />
                      <span className="truncate">{skill.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </Collapsible>

        <SidebarGroup>
          <SidebarGroupLabel>Canvases</SidebarGroupLabel>
          <SidebarGroupAction
            title="New folder"
            onClick={() => {
              setFolderDraft("");
              setCreatingFolder(true);
            }}
          >
            <FolderPlus />
            <span className="sr-only">New folder</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {creatingFolder && (
                <SidebarMenuItem>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitNewFolder();
                    }}
                  >
                    <SidebarInput
                      autoFocus
                      maxLength={MAX_FOLDER_NAME_LENGTH}
                      aria-label="Folder name"
                      placeholder="Folder name"
                      value={folderDraft}
                      onChange={(event) => setFolderDraft(event.target.value)}
                      onBlur={commitNewFolder}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setCreatingFolder(false);
                      }}
                    />
                  </form>
                </SidebarMenuItem>
              )}
              {folders.map((folder) => {
                const inside = byFolder.get(folder.id) ?? [];
                return (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    open={!collapsedSections.has(folder.id)}
                    onOpenChange={(open) =>
                      setSectionCollapsed(folder.id, !open)
                    }
                    onDelete={setPendingFolderDelete}
                    onDropCanvas={dropCanvasIntoFolder}
                    empty={inside.length === 0}
                  >
                    {inside.map(renderCanvas)}
                  </FolderItem>
                );
              })}
              {shown.length === 0 && folders.length === 0 && !creatingFolder && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Nothing here yet.
                </p>
              )}
              {unfiled.map(renderCanvas)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton />}>
                <span className="truncate text-xs">{email}</span>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem render={<Link href="/settings" />}>
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <ThemeMenu />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SkillDialog
        target={skillTarget}
        onOpenChange={(open) => {
          if (!open) setSkillTarget(null);
        }}
      />

      <ShareDialog
        conversation={shareTarget}
        onTokenChange={(share_token) => {
          if (shareTarget) applyUpdate({ ...shareTarget, share_token });
        }}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title="Delete canvas?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.title}
            </span>{" "}
            and every card on it will be deleted. This cannot be undone.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onConfirm={deleteConversation}
      />

      <ConfirmDialog
        open={pendingFolderDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingFolder) setPendingFolderDelete(null);
        }}
        title="Delete folder?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingFolderDelete?.name}
            </span>{" "}
            will be deleted. Any canvases in it stay, back at the top level.
          </>
        }
        confirmLabel={deletingFolder ? "Deleting…" : "Delete"}
        pending={deletingFolder}
        onConfirm={removeFolder}
      />
    </Sidebar>
  );
}
