import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar/ConversationList";
import { SessionWatcher } from "@/components/session-watcher";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  parseCollapsedSections,
} from "@/lib/sidebar-sections";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const [
    { data: conversations },
    { data: folders },
    { data: skills },
    cookieStore,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, updated_at, share_token, folder_id")
      .order("updated_at", { ascending: false }),
    supabase.from("folders").select("id, name").order("name"),
    supabase.from("skills").select("id, name").order("name"),
    cookies(),
  ]);

  return (
    <SidebarProvider>
      <SessionWatcher />
      <AppSidebar
        conversations={conversations ?? []}
        folders={folders ?? []}
        skills={skills ?? []}
        collapsed={parseCollapsedSections(
          cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value,
        )}
        email={user.email ?? "account"}
      />
      <main className="relative flex h-dvh flex-1 flex-col overflow-hidden">
        <SidebarTrigger className="absolute left-2 top-2 z-50" />
        {children}
      </main>
    </SidebarProvider>
  );
}
