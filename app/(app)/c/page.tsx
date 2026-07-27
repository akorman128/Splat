import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { NewConversationPrompt } from "./NewConversationPrompt";

// App home: land on the newest conversation, or offer to create the first one.
// This render is read-only by design — see createFirstConversation in
// ./actions.ts for why the INSERT that used to live here moved out.
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

  return <NewConversationPrompt />;
}
