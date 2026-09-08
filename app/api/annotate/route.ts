import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { decryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import {
  ANNOTATION_SYSTEM,
  DEFAULT_QUESTION,
  MAX_QUESTION_LENGTH,
  annotationContext,
  annotationPrompt,
} from "@/lib/providers/annotate";
import { MAX_QUOTE_LENGTH } from "@/lib/highlights/anchor";
import type { Provider } from "@/lib/providers/models";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { nodeId?: string; quote?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const quote = body.quote?.trim();
  if (!body.nodeId || !quote) {
    return NextResponse.json(
      { error: "nodeId and quote are required" },
      { status: 400 },
    );
  }
  if (quote.length > MAX_QUOTE_LENGTH) {
    return NextResponse.json(
      { error: "That passage is too long to ask about" },
      { status: 400 },
    );
  }
  const question = (body.question?.trim() || DEFAULT_QUESTION).slice(
    0,
    MAX_QUESTION_LENGTH,
  );

  // RLS scopes this to the reader's own cards, so a node id that is not theirs
  // is indistinguishable from one that does not exist.
  const { data: node } = await supabase
    .from("nodes")
    .select("prompt, response, provider, model, status")
    .eq("id", body.nodeId)
    .maybeSingle();
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }
  if (node.status !== "complete") {
    return NextResponse.json(
      { error: "Wait for this card to finish before asking about it" },
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

  try {
    const result = await getAdapter(provider).answerHighlight({
      apiKey: decryptSecret(cred.encrypted_key),
      system: ANNOTATION_SYSTEM,
      // Only ever the fallback target if the provider has retired its fast
      // model: a model this card already ran on is one the key can reach.
      model: node.model,
      prompt: annotationPrompt({
        quote,
        question,
        cardPrompt: node.prompt,
        context: annotationContext(node.response, quote),
      }),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not answer that: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 },
    );
  }
}
