import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";

// Stop, now that closing the tab no longer stops anything. The run outlives the
// request that started it, so the only way to reach it is through the row: this
// raises a flag, the run reads it on its next poll and winds down. That makes
// stopping eventually-consistent — a second or two, not instant — which is why
// the card keeps its spinner until the run itself writes the terminal status.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { nodeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const nodeId = body.nodeId;
  if (typeof nodeId !== "string" || !nodeId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();
  // Only a card actually mid-run, and RLS scopes it to the caller's own. One
  // that finished a moment ago keeps its answer rather than being flagged for a
  // run that is no longer listening.
  const { data: node, error } = await supabase
    .from("nodes")
    .update({ cancel_requested: true })
    .eq("id", nodeId)
    .eq("status", "streaming")
    .select()
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!node) {
    return NextResponse.json(
      { error: "That card is not running." },
      { status: 409 },
    );
  }
  return NextResponse.json({ node });
}
