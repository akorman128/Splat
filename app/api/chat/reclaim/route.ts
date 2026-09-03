import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { reclaimStaleStreams } from "@/lib/streams/reclaim";

// A run killed outright — a deploy, an eviction, a hard timeout — never reaches
// its own error write, so nothing announces it: Realtime simply goes quiet and
// the card keeps spinning. Reloading used to be the only way out, which is a
// poor answer for a page the user is already looking at. This is that page
// asking whether a card it can see has been abandoned.
//
// Safe to call speculatively: the cutoff is applied server-side, so a card whose
// run is merely slow is left alone.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // RLS scopes both the reclaim and this check to the caller's own rows.
  const supabase = await createClient();
  const nodes = await reclaimStaleStreams(supabase, conversationId);
  return NextResponse.json({ nodes });
}
