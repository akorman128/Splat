import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/types";

// The draft canvas has no conversation behind it, but an attachment row needs
// one to point at — so the first file attached creates it, the same way the
// first prompt does in /api/chat.
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({ title: DEFAULT_CONVERSATION_TITLE })
    .select("id")
    .single();
  if (error || !conversation) {
    return NextResponse.json(
      { error: error?.message ?? "Could not start a conversation" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: conversation.id });
}
