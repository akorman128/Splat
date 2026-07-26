import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// App home: land on the newest conversation, creating one on first visit.
// First-run users with no provider key are sent through onboarding once
// (the "skipped" cookie lets them decline and still reach the composer,
// which renders its own disabled state).
export default async function AppHome() {
  const supabase = await createClient();

  const { count: credCount } = await supabase
    .from("provider_creds")
    .select("id", { count: "exact", head: true });

  if (!credCount) {
    const cookieStore = await cookies();
    if (cookieStore.get("onboarding-skipped")?.value !== "1") {
      redirect("/onboarding");
    }
  }

  const { data: newest } = await supabase
    .from("conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (newest) {
    redirect(`/c/${newest.id}`);
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ title: "New conversation" })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Could not create a conversation: ${error?.message}`);
  }

  redirect(`/c/${created.id}`);
}
