import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/types";
import type { Provider } from "@/lib/providers/models";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { nodeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  const { data: node } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", body.nodeId)
    .maybeSingle();
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }
  if (node.status !== "complete") {
    return NextResponse.json(
      { error: "Suggestions are generated once a node completes" },
      { status: 409 },
    );
  }

  const provider = node.provider as Provider;
  const { data: cred } = await supabase
    .from("provider_creds")
    .select("encrypted_key")
    .eq("provider", provider)
    .maybeSingle();
  if (!cred) {
    return NextResponse.json(
      { error: `No ${provider} API key connected` },
      { status: 422 },
    );
  }

  let result;
  try {
    result = await getAdapter(provider).generateFollowups({
      apiKey: decryptSecret(cred.encrypted_key),
      prompt: node.prompt,
      response: node.response,
      model: node.model,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Follow-up generation failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 },
    );
  }

  await supabase
    .from("nodes")
    .update({ title: result.title })
    .eq("id", node.id);

  await supabase.from("suggestions").delete().eq("node_id", node.id);
  const { data: rows, error: insertError } = await supabase
    .from("suggestions")
    .insert(
      result.suggestions.map((text, position) => ({
        node_id: node.id,
        text,
        position,
      })),
    )
    .select();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Only ever names an untitled conversation: a title the user typed (or an
  // earlier root card's) is left alone.
  if (!node.parent_id) {
    await supabase
      .from("conversations")
      .update({ title: result.title })
      .eq("id", node.conversation_id)
      .eq("title", DEFAULT_CONVERSATION_TITLE);
  }

  return NextResponse.json({ title: result.title, suggestions: rows });
}
