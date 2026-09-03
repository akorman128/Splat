import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SharedConversationView } from "@/components/canvas/SharedConversationView";
import type { SharedConversation } from "@/lib/types";

// The token is the whole credential: the RPC is security-definer and returns a
// row only for an exact match, so an unshared (or unshared-again) conversation
// is a 404 here, signed in or not.
const sharedConversation = cache(
  async (token: string): Promise<SharedConversation | null> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("shared_conversation", {
      p_token: token,
    });
    return (data as SharedConversation | null) ?? null;
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const shared = await sharedConversation(token);
  if (!shared) return { title: "Conversation not found — 🫟 Splat" };

  return {
    title: `${shared.conversation.title} — 🫟 Splat`,
    description: `A shared Splat canvas: ${shared.nodes.length} card${
      shared.nodes.length === 1 ? "" : "s"
    } of prompts and answers, and how they branch.`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedConversationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await sharedConversation(token);
  if (!shared) notFound();

  return <SharedConversationView shared={shared} />;
}
