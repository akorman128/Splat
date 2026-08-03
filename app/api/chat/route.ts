import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { decryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import { isProvider, type Provider } from "@/lib/providers/models";
import { catalogEntry, isKnownCatalogModel } from "@/lib/providers/catalog";
import { validateContextSelection } from "@/lib/graph/cycle-check";
import { validateAttachmentSelection } from "@/lib/graph/attachment-selection";
import { topoOrder } from "@/lib/graph/topo-order";
import {
  nodeSkills,
  replaceNodeSkills,
  resolveSkillIds,
  skillSystemPrompt,
} from "@/lib/skills/attachments";
import {
  TURN_ATTACHMENT_COLUMNS,
  assembleMessages,
  loadInlineParts,
  type TurnAttachment,
} from "@/lib/attachments/content";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  MAX_ATTACHMENTS_PER_TURN,
} from "@/lib/attachments/types";
import type { ContentPart } from "@/lib/providers/types";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/types";
import type {
  AttachedSkill,
  CardAttachment,
  ContextEdgeRow,
  NodeRow,
} from "@/lib/types";

export const maxDuration = 300;

type NewChatBody = {
  conversationId: string | null;
  parentId: string | null;
  contextNodeIds: string[];
  skillIds?: string[];
  attachmentIds?: string[];
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

// Resolved before the node is written, so a bad key cannot blank the answer a
// regenerate was about to replace.
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

// Advisory for openrouter/auto, which reports the union of everything it might
// route to; an unreachable catalogue is not grounds for refusing a send.
async function imagesAllowed(
  provider: Provider,
  model: string,
  apiKey: string,
): Promise<boolean> {
  const entry = await catalogEntry(provider, model, apiKey);
  return entry?.supportsImages ?? true;
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
  // Both resolved before anything is written: a storage failure has to be a
  // clean JSON error, not a card left mid-stream.
  let turnAttachments: TurnAttachment[] = [];
  let inline: Map<string, ContentPart> = new Map();
  let claimedAttachments: CardAttachment[] = [];

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
      rerunFields = {
        prompt: nextPrompt,
        provider: nextProvider,
        model: nextModel,
        prompt_tokens: null,
        completion_tokens: null,
      };
    }

    const [nodesRes, edgesRes, ownEdgesRes, attachmentsRes] = await Promise.all([
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
      supabase
        .from("node_attachments")
        .select(`position, attachments!inner(${TURN_ATTACHMENT_COLUMNS})`)
        .eq("node_id", existing.id)
        .order("position"),
    ]);
    conversationNodes = nodesRes.data ?? [];
    conversationEdges = (edgesRes.data ?? []) as unknown as ContextEdgeRow[];
    nodeEdges = ownEdgesRes.data ?? [];
    contextIds = nodeEdges.map((e) => e.source_node_id);
    turnAttachments = (
      (attachmentsRes.data ?? []) as unknown as {
        attachments: TurnAttachment;
      }[]
    ).map((row) => row.attachments);

    const rerunProvider = (rerunFields.provider ??
      existing.provider) as Provider;
    const rerunModel = rerunFields.model ?? existing.model;
    const rerunKey = await resolveApiKey(supabase, rerunProvider);
    if (!rerunKey.ok) {
      return NextResponse.json(
        { error: rerunKey.error },
        { status: rerunKey.status },
      );
    }
    apiKey = rerunKey.apiKey;

    // Only a regenerate can change the model; a retry replays what the card
    // already holds, and the catalogue is read with the key that will send it.
    if (
      regenerating &&
      !(await isKnownCatalogModel(rerunProvider, rerunModel, apiKey))
    ) {
      return NextResponse.json(
        { error: `Unknown model for ${rerunProvider}: ${rerunModel}` },
        { status: 400 },
      );
    }

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

    if (
      turnAttachments.some((a) => a.kind === "image") &&
      !(await imagesAllowed(rerunProvider, rerunModel, apiKey))
    ) {
      return NextResponse.json(
        {
          error: `${rerunModel} cannot read images, and this card sent one. Pick a model that can.`,
        },
        { status: 422 },
      );
    }
    const rerunInline = await loadInlineParts(supabase, turnAttachments);
    if (!rerunInline.ok) {
      return NextResponse.json(
        { error: rerunInline.error },
        { status: rerunInline.status },
      );
    }
    inline = rerunInline.inline;

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
      parentId,
      contextNodeIds: rawContextNodeIds,
      prompt,
      provider,
      model,
    } = body;
    let conversationId = body.conversationId ?? null;
    if (
      !prompt?.trim() ||
      !provider ||
      !isProvider(provider) ||
      !model ||
      !Array.isArray(rawContextNodeIds)
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const contextNodeIds = [...new Set(rawContextNodeIds)];

    if (conversationId) {
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
        supabase.from("nodes").select("*").eq("conversation_id", conversationId),
        supabase
          .from("context_edges")
          .select("*, nodes!context_edges_node_id_fkey!inner(conversation_id)")
          .eq("nodes.conversation_id", conversationId),
      ]);
      conversationNodes = nodesRes.data ?? [];
      conversationEdges = (edgesRes.data ?? []) as unknown as ContextEdgeRow[];
    } else {
      if (parentId || contextNodeIds.length > 0) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      conversationNodes = [];
      conversationEdges = [];
    }

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

    // After the key, because the catalogue that answers this is the one that
    // key can reach.
    if (!(await isKnownCatalogModel(provider, model, apiKey))) {
      return NextResponse.json(
        { error: `Unknown model for ${provider}: ${model}` },
        { status: 400 },
      );
    }

    const attachmentIds = [
      ...new Set(
        (Array.isArray(body.attachmentIds) ? body.attachmentIds : []).filter(
          (id): id is string => typeof id === "string",
        ),
      ),
    ];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_TURN) {
      return NextResponse.json(
        {
          error: `A single prompt can carry at most ${MAX_ATTACHMENTS_PER_TURN} files.`,
        },
        { status: 400 },
      );
    }
    if (attachmentIds.length > 0) {
      if (!conversationId) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      const { data: rows } = await supabase
        .from("attachments")
        .select(TURN_ATTACHMENT_COLUMNS)
        .in("id", attachmentIds);
      const byId = new Map(
        ((rows ?? []) as unknown as TurnAttachment[]).map((row) => [
          row.id,
          row,
        ]),
      );
      if (byId.size !== attachmentIds.length) {
        return NextResponse.json(
          { error: "One of those files no longer exists" },
          { status: 400 },
        );
      }
      turnAttachments = attachmentIds.map((id) => byId.get(id)!);

      const attachmentProblem = validateAttachmentSelection({
        conversationId,
        parentId: parentId ?? null,
        attachments: turnAttachments,
        nodes: conversationNodes,
        edges: conversationEdges,
      });
      if (attachmentProblem) {
        return NextResponse.json({ error: attachmentProblem }, { status: 400 });
      }

      if (
        turnAttachments.some((a) => a.kind === "image") &&
        !(await imagesAllowed(provider, model, apiKey))
      ) {
        return NextResponse.json(
          {
            error: `${model} cannot read images. Pick a model that can, or remove the image.`,
          },
          { status: 422 },
        );
      }

      // Before any write: nothing is claimed yet, and there is no node to roll
      // back.
      const load = await loadInlineParts(supabase, turnAttachments);
      if (!load.ok) {
        return NextResponse.json(
          { error: load.error },
          { status: load.status },
        );
      }
      inline = load.inline;
    }

    // Created only now, after every validation above has passed, so a
    // rejected or abandoned draft never leaves an empty row in the sidebar.
    let discardDraft: (() => Promise<unknown>) | null = null;
    if (!conversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({ title: DEFAULT_CONVERSATION_TITLE })
        .select("id")
        .single();
      if (conversationError || !conversation) {
        return NextResponse.json(
          {
            error:
              conversationError?.message ?? "Could not start a conversation",
          },
          { status: 500 },
        );
      }
      conversationId = conversation.id;
      // Nodes and edges cascade from the conversation, so this is the entire rollback.
      discardDraft = async () => {
        await supabase.from("conversations").delete().eq("id", conversation.id);
      };
    }

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
      await discardDraft?.();
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
        await discardDraft?.();
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
      await discardDraft?.();
      return NextResponse.json({ error: skillFailure }, { status: 400 });
    }

    // Write order is load-bearing: node, then context edges, then files —
    // check_node_attachment reads context_edges live to decide whether the
    // owning card is reachable.
    if (turnAttachments.length > 0) {
      const drafts = turnAttachments.filter((a) => a.node_id === null);
      const claimedPaths: string[] = [];

      // A claim cannot be undone — the trigger refuses to move an attachment
      // between cards — so a rollback here takes the bytes too.
      const rollback = async (message: string, status: number) => {
        if (claimedPaths.length > 0) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove(claimedPaths);
        }
        await supabase.from("nodes").delete().eq("id", node.id);
        await discardDraft?.();
        return NextResponse.json({ error: message }, { status });
      };

      if (drafts.length > 0) {
        const { data: claimed, error: claimError } = await supabase
          .from("attachments")
          .update({ node_id: node.id })
          .in(
            "id",
            drafts.map((a) => a.id),
          )
          .is("node_id", null)
          .select(CARD_ATTACHMENT_COLUMNS);
        claimedAttachments = (claimed ?? []) as unknown as CardAttachment[];
        const claimedIds = new Set(claimedAttachments.map((a) => a.id));
        for (const draft of drafts) {
          if (claimedIds.has(draft.id)) {
            claimedPaths.push(draft.storage_path);
            draft.node_id = node.id;
          }
        }
        if (claimError || claimedIds.size !== drafts.length) {
          return rollback(
            claimError?.message ??
              "One of those files has already been sent with another card.",
            claimError ? 500 : 409,
          );
        }
      }

      const { error: linkError } = await supabase
        .from("node_attachments")
        .insert(
          turnAttachments.map((attachment, index) => ({
            node_id: node.id,
            attachment_id: attachment.id,
            filename: attachment.filename,
            mime_type: attachment.mime_type,
            kind: attachment.kind,
            position: index,
          })),
        );
      if (linkError) return rollback(linkError.message, 400);
    }
  }

  const provider = node.provider as Provider;

  const nodesById = new Map(conversationNodes.map((n) => [n.id, n]));
  const messages = assembleMessages({
    contextIds,
    nodesById,
    node,
    attachments: turnAttachments,
    inline,
  });

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

      send({
        type: "node",
        node,
        edges: nodeEdges,
        attachments: claimedAttachments,
      });

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
