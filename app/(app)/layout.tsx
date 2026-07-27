import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authClaims } from "@/lib/supabase/claims";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar/ConversationList";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const [{ data: conversations }, { data: skills }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, updated_at, share_token")
      .order("updated_at", { ascending: false }),
    supabase.from("skills").select("id, name").order("name"),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        conversations={conversations ?? []}
        skills={skills ?? []}
        email={claims.email ?? "account"}
      />
      <main className="relative flex h-dvh flex-1 flex-col overflow-hidden">
        <SidebarTrigger className="absolute left-2 top-2 z-50" />
        {children}
      </main>
    </SidebarProvider>
  );
}
