"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authClaims } from "@/lib/supabase/claims";

/**
 * Create the user's first conversation and land on it.
 *
 * Deliberately an action rather than something the /c render does. The page
 * used to INSERT during its GET whenever the user had no conversation, which
 * meant two near-simultaneous renders — two tabs, a double-tap, a router
 * prefetch of any `<Link href="/c">` — each saw `newest === null` and each
 * inserted, leaving orphan "New conversation" rows that nothing cleans up
 * (`touch_conversation` only fires on node insert, and there is no delete
 * path).
 *
 * The re-read below keeps it idempotent for the case that actually happens
 * here: a conversation created in another tab, or by a double submit, since
 * this page rendered. Next dispatches actions one at a time per client, so
 * the second of a double submit finds the first one's row and joins it
 * instead of creating a twin.
 */
export async function createFirstConversation() {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    redirect(`/c/${existing.id}`);
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ title: "New conversation" })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Could not create a conversation: ${error?.message}`);
  }

  // The sidebar lists conversations from the (app) layout, which a plain
  // navigation would not re-render. Revalidate before redirecting so the new
  // row is in the list the destination ships with.
  revalidatePath("/c", "layout");
  redirect(`/c/${created.id}`);
}
