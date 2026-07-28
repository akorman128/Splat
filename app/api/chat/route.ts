import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { decryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import {
  MODELS,
  hasModelCatalog,
  isProvider,
  type Provider,
} from "@/lib/providers/models";
import { isKnownCatalogModel } from "@/lib/providers/catalog";
import { validateContextSelection } from "@/lib/graph/cycle-check";
import { topoOrder } from "@/lib/graph/topo-order";
import {
  nodeSkills,
  replaceNodeSkills,
  resolveSkillIds,
  skillSystemPrompt,
} from "@/lib/skills/attachments";
import type { ChatMessage } from "@/lib/providers/types";
import type { AttachedSkill, ContextEdgeRow, NodeRow } from "@/lib/types";

export const maxDuration = 300;

type NewChatBody = {
  conversationId: string;
  parentId: string | null;
  contextNodeIds: string[];
  skillIds?: string[];
  prompt: string;
  provider: string;
  model: string;
  canvasX?: number;
  canvasY?: number;
};

type RetryBody = { retryNodeId: string };

type RegenerateBody = {
  regenerateNodeId: string;
  prompt?: string;
  provider?: string;
  model?: string;
  skillIds?: string[];
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type KeyResult =
  | { ok: true; apiKey: string }
  | { ok: false; status: number; error: string };

// Resolved before the node is written, so a missing or undecryptable key can
// never blank the answer a regenerate was about to replace.
async function resolveApiKey(
  supabase: SupabaseServerClient,
  provider: Provider,
): Promise<KeyResult> {
  const { data: cred } = await supabase
    .from("provider_creds")
    .select("encrypted_key")
    .eq("provider", provider)
    .maybeSingle();
  if (!cred) {
    return {
      ok: false,
      status: 422,
      error: `No ${provider} API key connected. Add one in Settings.`,
    };
  }
  try {
    return { ok: true, apiKey: decryptSecret(cred.encrypted_key) };
  } catch {
    return {
      ok: false,
      status: 500,
      error: `Stored ${provider} key could not be decrypted. Re-add it in Settings.`,
    };
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Partial<NewChatBody & RetryBody & RegenerateBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let node: NodeRow;
  let nodeEdges: ContextEdgeRow[];
  let contextIds: string[];
  let attachedSkills: AttachedSkill[];
  let conversationNodes: NodeRow[];
  let conversationEdges: ContextEdgeRow[];
  let apiKey: string;

  const rerunNodeId = body.retryNodeId ?? body.regenerateNodeId;

  if (rerunNodeId) {
    const regenerating = !body.retryNodeId;
    const { data: existing } = await supabase
      .from("nodes")
      .select("*")
      .eq("id", rerunNodeId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    const rerunnable = regenerating ? ["complete", "error"] : ["error"];
    if (!rerunnable.includes(existing.status)) {
      return NextResponse.json(
        {
          error:
            existing.status === "streaming"
              ? "Node is already streaming"
              : regenerating
                ? `A card can only be regenerated once it has finished (this one is ${existing.status})`
                : `Only a card that errored can be retried (this one is ${existing.status})`,
        },
        { status: 409 },
      );
    }

    let rerunFields: {
      prompt?: string;
      provider?: string;
      model?: string;
      prompt_tokens?: null;
      completion_tokens?: null;
    } = {};
    if (regenerating) {
      const nextPrompt = (body.prompt ?? existing.prompt).trim();
      const nextProvider = body.provider ?? existing.provider;
      const nextModel = body.model ?? existing.model;
      if (!nextPrompt || !isProvider(nextProvider) || !nextModel) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      const modelAllowed = hasModelCatalog(nextProvider)
        ? await isKnownCatalogModel(nextProvider, nextModel)
        : nextModel === MODELS[nextProvider].conversation;
      if (!modelAllowed) {
        return NextResponse.json(
          { error: `Unknown model for ${nextProvider}: ${nextModel}` },
          { status: 400 },
        );
      }
      rerunFields = {
        prompt: nextPrompt,
        provider: nextProvider,
        model: nextModel,
        prompt_tokens: null,
        completion_tokens: null,
      };
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

    const rerunKey = await resolveApiKey(
      supabase,
      (rerunFields.provider ?? existing.provider) as Provider,
    );
    if (!rerunKey.ok) {
      return NextResponse.json(
        { error: rerunKey.error },
        { status: rerunKey.status },
      );
    }
    apiKey = rerunKey.apiKey;

    // Omitting skillIds on a regenerate keeps whatever the card already
    // carries; sending them (even empty) replaces the set.
    const rerunSkillIds =
      regenerating && Array.isArray(body.skillIds)
        ? [...new Set(body.skillIds)]
        : null;
    if (rerunSkillIds) {
      const selection = await resolveSkillIds(supabase, rerunSkillIds);
      if (!selection.ok) {
        return NextResponse.json({ error: selection.error }, { status: 400 });
      }
      attachedSkills = selection.skills;
    } else {
      attachedSkills = await nodeSkills(supabase, existing.id);
    }

    const { data: reset, error: resetError } = await supabase
      .from("nodes")
      .update({
        ...rerunFields,
        response: "",
        status: "streaming",
        error_message: null,
      })
      .eq("id", existing.id)
      .in("status", rerunnable)
      .select()
      .maybeSingle();
    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }
    if (!reset) {
      return NextResponse.json(
        {
          error: `This card is already being ${regenerating ? "regenerated" : "retried"}`,
        },
        { status: 409 },
      );
    }
    node = reset;

    if (rerunSkillIds) {
      const failure = await replaceNodeSkills(supabase, node.id, attachedSkills);
      if (failure) {
        await supabase
          .from("nodes")
          .update({ status: "error", error_message: failure })
          .eq("id", node.id);
        return NextResponse.json({ error: failure }, { status: 400 });
      }
    }
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
    const contextNodeIds = [...new Set(rawContextNodeIds)];
    const modelAllowed = hasModelCatalog(provider)
      ? await isKnownCatalogModel(provider, model)
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

    const selection = await resolveSkillIds(
      supabase,
      Array.isArray(body.skillIds) ? [...new Set(body.skillIds)] : [],
    );
    if (!selection.ok) {
      return NextResponse.json({ error: selection.error }, { status: 400 });
    }
    attachedSkills = selection.skills;

    const newKey = await resolveApiKey(supabase, provider);
    if (!newKey.ok) {
      return NextResponse.json({ error: newKey.error }, { status: newKey.status });
    }
    apiKey = newKey.apiKey;

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

    const skillFailure = await replaceNodeSkills(
      supabase,
      node.id,
      attachedSkills,
    );
    if (skillFailure) {
      await supabase.from("nodes").delete().eq("id", node.id);
      return NextResponse.json({ error: skillFailure }, { status: 400 });
    }
  }

  const provider = node.provider as Provider;

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

  const system = skillSystemPrompt(attachedSkills);

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
          system,
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
        send({ type: "done", node: finalNode ?? { ...node, ...completed } });
      } catch (err) {
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
