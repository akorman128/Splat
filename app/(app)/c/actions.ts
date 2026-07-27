"use server";

import { randomBytes } from "node:crypto";
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

// The share link is the credential, so the token is minted server-side and is
// the only way into /s/[token]. Re-sharing a conversation that already has one
// returns the same link rather than invalidating the one already sent out.
export async function shareConversation(
  conversationId: string,
): Promise<string> {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const { data: existing, error: readError } = await supabase
    .from("conversations")
    .select("share_token")
    .eq("id", conversationId)
    .maybeSingle();
  if (readError) {
    throw new Error(`Could not read the conversation: ${readError.message}`);
  }
  if (!existing) {
    throw new Error("Conversation not found");
  }
  if (existing.share_token) return existing.share_token;

  const token = randomBytes(18).toString("base64url");
  const { error } = await supabase
    .from("conversations")
    .update({ share_token: token, shared_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) {
    throw new Error(`Could not share the conversation: ${error.message}`);
  }

  revalidatePath("/c", "layout");
  return token;
}

export async function unshareConversation(conversationId: string) {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("conversations")
    .update({ share_token: null, shared_at: null })
    .eq("id", conversationId);
  if (error) {
    throw new Error(`Could not stop sharing: ${error.message}`);
  }

  revalidatePath("/c", "layout");
}
