import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

  redirect(newest ? `/c/${newest.id}` : "/c/new");
}
