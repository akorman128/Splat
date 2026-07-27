"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
import {
  ChevronsUpDown,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
};

export function AppSidebar({
  conversations,
  email,
}: {
  conversations: ConversationSummary[];
  email: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  async function newConversation() {
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: "New conversation" })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Could not create conversation", {
        description: error?.message,
      });
      return;
    }
    router.push(`/c/${data.id}`);
    router.refresh();
  }

  async function deleteConversation() {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast.error("Could not delete conversation", {
        description: error.message,
      });
      return;
    }
    const wasOpen = pathname === `/c/${pendingDelete.id}`;
    setPendingDelete(null);
    if (wasOpen) router.push("/c");
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-lg font-semibold tracking-tight">🫟 Splat</span>
        </div>
        <Button
          size="lg"
          className="mx-2 mb-1"
          onClick={newConversation}
          disabled={creating}
        >
          <Plus className="size-4" />
          New conversation
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Nothing here yet.
                </p>
              )}
              {conversations.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    isActive={pathname === `/c/${c.id}`}
                    className="pr-8"
                    render={<Link href={`/c/${c.id}`} />}
                  >
                    <MessageSquare className="size-4" />
                    <span className="truncate">{c.title}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    title="Delete conversation"
                    className="hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingDelete(c)}
                  >
                    <Trash2 />
                    <span className="sr-only">Delete conversation</span>
                  </SidebarMenuAction>
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
                <DropdownMenuItem onSelect={signOut}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title="Delete conversation?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.title}
            </span>{" "}
            and every card on its canvas will be deleted. This cannot be undone.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onConfirm={deleteConversation}
      />
    </Sidebar>
  );
}
