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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
import { DownloadMenu } from "./DownloadMenu";
import { ShareDialog } from "./ShareDialog";
import type { SkillSummary } from "@/lib/types";
import {
  ChevronsUpDown,
  Link2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
  share_token: string | null;
};

export function AppSidebar({
  conversations,
  skills,
  email,
}: {
  conversations: ConversationSummary[];
  skills: SkillSummary[];
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [shown, applyUpdate] = useOptimistic(
    conversations,
    (list: ConversationSummary[], updated: ConversationSummary) =>
      list.map((c) => (c.id === updated.id ? updated : c)),
  );

  // A dialog owns the screen while it is open, so leave the keys to it rather
  // than routing or opening a second one behind it.
  const dialogOpen =
    skillTarget !== null || shareTarget !== null || pendingDelete !== null;

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

  function startRename(c: ConversationSummary) {
    setDraft(c.title);
    setRenamingId(c.id);
  }

  function commitRename(c: ConversationSummary) {
    const title = draft.trim();
    setRenamingId(null);
    if (!title || title === c.title) return;
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

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
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
        <SidebarGroup>
          <SidebarGroupLabel>Skills</SidebarGroupLabel>
          <SidebarGroupAction
            title="New skill"
            onClick={() => setSkillTarget({ kind: "new" })}
          >
            <Plus />
            <span className="sr-only">New skill</span>
          </SidebarGroupAction>
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
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Canvases</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {shown.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Nothing here yet.
                </p>
              )}
              {shown.map((c) => (
                <SidebarMenuItem key={c.id}>
                  {renamingId === c.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitRename(c);
                      }}
                    >
                      <SidebarInput
                        autoFocus
                        maxLength={120}
                        aria-label="Canvas title"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={() => commitRename(c)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                      />
                    </form>
                  ) : (
                    <>
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
                          render={
                            <SidebarMenuAction showOnHover title="More" />
                          }
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
                          <DropdownMenuItem onClick={() => startRename(c)}>
                            <Pencil className="size-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setShareTarget(c)}>
                            <Share2 className="size-4" />
                            {c.share_token ? "Share link" : "Share"}
                          </DropdownMenuItem>
                          <DownloadMenu conversationId={c.id} />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(c)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </SidebarMenuItem>
              ))}
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
    </Sidebar>
  );
}
