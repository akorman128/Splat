import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import {
  MODELS,
  hasModelCatalog,
  isProvider,
  type Provider,
} from "@/lib/providers/models";
import { isKnownOpenRouterModel } from "@/lib/providers/catalog";
import { validateContextSelection } from "@/lib/graph/cycle-check";
import { topoOrder } from "@/lib/graph/topo-order";
import type { ChatMessage } from "@/lib/providers/types";
import type { ContextEdgeRow, NodeRow } from "@/lib/types";

// Streamed chat completion. All LLM calls originate here (and in
// /api/suggestions) — provider SDKs and keys never reach the client.
// Responds with NDJSON: {type:"node"} → {type:"delta"}* → {type:"done"|"error"}.

export const maxDuration = 300;

type NewChatBody = {
  conversationId: string;
  parentId: string | null;
  contextNodeIds: string[];
  prompt: string;
  provider: string;
  model: string;
  canvasX?: number;
  canvasY?: number;
};

type RetryBody = { retryNodeId: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Partial<NewChatBody & RetryBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let node: NodeRow;
  let nodeEdges: ContextEdgeRow[];
  let contextIds: string[];
  let conversationNodes: NodeRow[];
  let conversationEdges: ContextEdgeRow[];

  if (body.retryNodeId) {
    // Retry: fresh attempt on an existing errored node. Same prompt, same
    // stored context set — no resuming or splicing onto truncated text.
    const { data: existing } = await supabase
      .from("nodes")
      .select("*")
      .eq("id", body.retryNodeId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    // Retry is only ever offered on an errored card, and it destroys whatever
    // response is there. Accepting a "complete" node would wipe a good answer
    // (retry never splices) and re-bill the user's key, so require "error".
    if (existing.status !== "error") {
      return NextResponse.json(
        {
          error:
            existing.status === "streaming"
              ? "Node is already streaming"
              : `Only a card that errored can be retried (this one is ${existing.status})`,
        },
        { status: 409 },
      );
    }

    const [nodesRes, edgesRes, ownEdgesRes] = await Promise.all([
      supabase
        .from("nodes")
        .select("*")
        .eq("conversation_id", existing.conversation_id),
      supabase
        .from("context_edges")
        .select("*, nodes!context_edges_node_id_fkey!inner(conversation_id)")
        .eq("nodes.conversation_id", existing.conversation_id),
      supabase
        .from("context_edges")
        .select("*")
        .eq("node_id", existing.id)
        .order("position"),
    ]);
    conversationNodes = nodesRes.data ?? [];
    conversationEdges = (edgesRes.data ?? []) as unknown as ContextEdgeRow[];
    nodeEdges = ownEdgesRes.data ?? [];
    contextIds = nodeEdges.map((e) => e.source_node_id);

    // Compare-and-swap, not a bare write: the status check above is a separate
    // round trip, so two concurrent retries (a double-clicked button) would
    // both read "error" and both proceed, interleaving two streams onto one
    // row. Claiming the node by matching on status="error" means exactly one
    // request wins and the loser gets a 409.
    const { data: reset, error: resetError } = await supabase
      .from("nodes")
      .update({ response: "", status: "streaming", error_message: null })
      .eq("id", existing.id)
      .eq("status", "error")
      .select()
      .maybeSingle();
    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }
    if (!reset) {
      return NextResponse.json(
        { error: "This card is already being retried" },
        { status: 409 },
      );
    }
    node = reset;
  } else {
    const {
      conversationId,
      parentId,
      contextNodeIds: rawContextNodeIds,
      prompt,
      provider,
      model,
    } = body;
    if (
      !conversationId ||
      !prompt?.trim() ||
      !provider ||
      !isProvider(provider) ||
      !model ||
      !Array.isArray(rawContextNodeIds)
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    // Deduplicate before anything downstream sees the list. Membership was
    // checked but repeats were not, and topoOrder preserves duplicates for
    // independent nodes — so [X, X] survived all the way to the context_edges
    // insert, where it tripped `unique (node_id, source_node_id)`. By then the
    // node row existed, so the failure path created a card, deleted it again,
    // and handed the caller a raw Postgres "duplicate key value" string.
    const contextNodeIds = [...new Set(rawContextNodeIds)];
    // Providers with a pinned tier accept exactly that id. Catalogue providers
    // accept anything the catalogue currently lists — checked here, before a
    // node row exists, so a typo is a 400 on the composer rather than a card
    // that has to be created only to immediately fail.
    const modelAllowed = hasModelCatalog(provider)
      ? await isKnownOpenRouterModel(model)
      : model === MODELS[provider].conversation;
    if (!modelAllowed) {
      return NextResponse.json(
        { error: `Unknown model for ${provider}: ${model}` },
        { status: 400 },
      );
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Load the graph once; RLS already scopes rows to this user, and the
    // conversation filter pins every referenced node to this conversation.
    const [nodesRes, edgesRes] = await Promise.all([
      supabase
        .from("nodes")
        .select("*")
        .eq("conversation_id", conversationId),
      supabase
        .from("context_edges")
        .select("*, nodes!context_edges_node_id_fkey!inner(conversation_id)")
        .eq("nodes.conversation_id", conversationId),
    ]);
    conversationNodes = nodesRes.data ?? [];
    conversationEdges = (edgesRes.data ?? []) as unknown as ContextEdgeRow[];

    const knownIds = new Set(conversationNodes.map((n) => n.id));
    if (parentId && !knownIds.has(parentId)) {
      return NextResponse.json(
        { error: "Parent node not found in this conversation" },
        { status: 400 },
      );
    }
    for (const id of contextNodeIds) {
      if (!knownIds.has(id)) {
        return NextResponse.json(
          { error: "Context node not found in this conversation" },
          { status: 400 },
        );
      }
    }
    const problem = validateContextSelection({
      parentId: parentId ?? null,
      contextNodeIds,
      nodes: conversationNodes,
      edges: conversationEdges,
    });
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    contextIds = topoOrder(contextNodeIds, conversationNodes, conversationEdges);

    const { data: created, error: createError } = await supabase
      .from("nodes")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        parent_id: parentId ?? null,
        prompt: prompt.trim(),
        provider,
        model,
        status: "streaming",
        canvas_x: typeof body.canvasX === "number" ? body.canvasX : 0,
        canvas_y: typeof body.canvasY === "number" ? body.canvasY : 0,
      })
      .select()
      .single();
    if (createError || !created) {
      return NextResponse.json(
        { error: createError?.message ?? "Could not create node" },
        { status: 500 },
      );
    }
    node = created;

    if (contextIds.length > 0) {
      const { data: insertedEdges, error: edgeError } = await supabase
        .from("context_edges")
        .insert(
          contextIds.map((sourceId, index) => ({
            node_id: node.id,
            source_node_id: sourceId,
            position: index,
          })),
        )
        .select();
      if (edgeError) {
        await supabase.from("nodes").delete().eq("id", node.id);
        return NextResponse.json({ error: edgeError.message }, { status: 400 });
      }
      nodeEdges = insertedEdges ?? [];
    } else {
      nodeEdges = [];
    }
  }

  // Decrypt the key server-side; never returned to the client.
  const provider = node.provider as Provider;
  const { data: cred } = await supabase
    .from("provider_creds")
    .select("encrypted_key")
    .eq("provider", provider)
    .maybeSingle();
  if (!cred) {
    await supabase
      .from("nodes")
      .update({
        status: "error",
        error_message: `No ${provider} API key connected`,
      })
      .eq("id", node.id);
    return NextResponse.json(
      { error: `No ${provider} API key connected. Add one in Settings.` },
      { status: 422 },
    );
  }
  // The node is already "streaming" at this point (freshly inserted, or reset
  // by the retry path above). decryptSecret throws on a missing/short
  // APP_ENCRYPTION_KEY or a corrupt ciphertext, and letting that escape would
  // strand the row in "streaming" forever — the card spins indefinitely and
  // CardBody only offers Retry on "error". Mark it errored like the
  // missing-credential branch does.
  let apiKey: string;
  try {
    apiKey = decryptSecret(cred.encrypted_key);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    await supabase
      .from("nodes")
      .update({
        status: "error",
        error_message: `Stored ${provider} key could not be decrypted: ${detail}`,
      })
      .eq("id", node.id);
    return NextResponse.json(
      {
        error: `Stored ${provider} key could not be decrypted. Re-add it in Settings.`,
      },
      { status: 500 },
    );
  }

  // Assemble the message array: selected context cards, topological order,
  // oldest first — each contributes its prompt/response pair — then the new
  // prompt.
  const nodesById = new Map(conversationNodes.map((n) => [n.id, n]));
  const messages: ChatMessage[] = [];
  for (const id of contextIds) {
    const contextNode = nodesById.get(id);
    if (!contextNode) continue;
    messages.push({ role: "user", content: contextNode.prompt });
    if (contextNode.response) {
      messages.push({ role: "assistant", content: contextNode.response });
    }
  }
  messages.push({ role: "user", content: node.prompt });

  const adapter = getAdapter(provider);
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          cancelled = true;
        }
      };

      send({ type: "node", node, edges: nodeEdges });

      let accumulated = "";
      let flushedLength = 0;
      let lastFlushAt = Date.now();
      let usage: { promptTokens: number | null; completionTokens: number | null } =
        { promptTokens: null, completionTokens: null };

      // Partial responses are never discarded: flush the buffer to Supabase
      // every ~2s or ~500 chars so a hard client death still leaves the
      // partial answer on the server.
      const maybeFlush = async () => {
        if (
          accumulated.length - flushedLength >= 500 ||
          (Date.now() - lastFlushAt >= 2000 && accumulated.length > flushedLength)
        ) {
          flushedLength = accumulated.length;
          lastFlushAt = Date.now();
          await supabase
            .from("nodes")
            .update({ response: accumulated })
            .eq("id", node.id);
        }
      };

      try {
        for await (const event of adapter.streamChat({
          apiKey,
          model: node.model,
          messages,
        })) {
          if (cancelled) {
            throw new Error("Generation interrupted: connection closed");
          }
          if (event.type === "delta") {
            accumulated += event.text;
            send({ type: "delta", text: event.text });
            await maybeFlush();
          } else if (event.type === "usage") {
            usage = {
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
            };
          }
        }

        const completed = {
          response: accumulated,
          status: "complete" as const,
          error_message: null,
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
        };
        const { data: finalNode } = await supabase
          .from("nodes")
          .update(completed)
          .eq("id", node.id)
          .select()
          .maybeSingle();
        // The re-select comes back null if the update matched no rows (the
        // node or its conversation was deleted mid-stream, or a transient
        // failure). ChatStreamEvent types done.node as non-nullable and the
        // client dereferences it straight away, so falling back to the row we
        // already hold keeps that contract — emitting null here would throw in
        // handleEvent and rewrite a *successful* card as "Connection lost".
        send({ type: "done", node: finalNode ?? { ...node, ...completed } });
      } catch (err) {
        // Whatever tokens already arrived are kept and persisted.
        const message =
          err instanceof Error ? err.message : "Generation failed";
        const errored = {
          response: accumulated,
          status: "error" as const,
          error_message: message,
        };
        const { data: errorNode } = await supabase
          .from("nodes")
          .update(errored)
          .eq("id", node.id)
          .select()
          .maybeSingle();
        send({
          type: "error",
          message,
          node: errorNode ?? { ...node, ...errored },
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed/cancelled
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
