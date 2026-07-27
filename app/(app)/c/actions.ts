"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authClaims } from "@/lib/supabase/claims";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/types";

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
    .insert({ title: DEFAULT_CONVERSATION_TITLE })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Could not create a conversation: ${error?.message}`);
  }

  revalidatePath("/c", "layout");
  redirect(`/c/${created.id}`);
}
