"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, GitBranch, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContextPicker } from "./ContextPicker";
import { ModelPicker } from "./ModelPicker";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useChatStream } from "@/lib/chat-client";
import { parentChain } from "@/lib/graph/ancestors";
import { childPosition, rootPosition } from "@/lib/layout";
import {
  PROVIDER_LABELS,
  conversationModelLabel,
  defaultModel,
  hasModelCatalog,
  isProvider,
  type Provider,
} from "@/lib/providers/models";
import type { CredentialSummary } from "@/lib/types";

function providerLabel(provider: Provider): string {
  return hasModelCatalog(provider)
    ? PROVIDER_LABELS[provider]
    : conversationModelLabel(provider);
}

export function Composer({
  credentials,
  centered = false,
}: {
  credentials: CredentialSummary[];
  centered?: boolean;
}) {
  const router = useRouter();
  const chat = useChatStream();
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const provider = useComposerStore((s) => s.provider);
  const setProvider = useComposerStore((s) => s.setProvider);
  const model = useComposerStore((s) => s.model);
  const setModel = useComposerStore((s) => s.setModel);
  const regenerateNodeId = useComposerStore((s) => s.regenerateNodeId);
  const setRegenerateNode = useComposerStore((s) => s.setRegenerateNode);
  const parent = useGraphStore((s) =>
    s.selectedNodeId ? s.nodes[s.selectedNodeId] : undefined,
  );
  const regenerateTarget = useGraphStore((s) =>
    regenerateNodeId ? s.nodes[regenerateNodeId] : undefined,
  );

  const connectedProviders = credentials.map((c) => c.provider);
  const hasKey = connectedProviders.length > 0;

  useEffect(() => {
    if (!provider || !connectedProviders.includes(provider)) {
      setProvider(connectedProviders[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials.map((c) => c.provider).join(",")]);

  const [lastParentId, setLastParentId] = useState<string | null>(null);
  if ((parent?.id ?? null) !== lastParentId) {
    setLastParentId(parent?.id ?? null);
    if (!parent) {
      setChecked({});
    } else {
      const graph = useGraphStore.getState();
      const chain = parentChain(parent.id, Object.values(graph.nodes));
      setChecked(Object.fromEntries(chain.map((id) => [id, true])));
    }
  }

  const [parkedDraft, setParkedDraft] = useState("");
  const [lastRegenerateId, setLastRegenerateId] = useState<string | null>(null);
  if (regenerateNodeId !== lastRegenerateId) {
    setLastRegenerateId(regenerateNodeId);
    if (regenerateNodeId) {
      if (lastRegenerateId === null) setParkedDraft(prompt);
      setPrompt(useGraphStore.getState().nodes[regenerateNodeId]?.prompt ?? "");
    } else {
      setPrompt(parkedDraft);
      setParkedDraft("");
    }
  }

  const connectedKey = connectedProviders.join(",");
  const parkedPick = useRef<{
    provider: Provider | null;
    model: string | null;
  } | null>(null);

  useEffect(() => {
    const composer = useComposerStore.getState();
    if (!regenerateNodeId) {
      const parked = parkedPick.current;
      if (parked) {
        parkedPick.current = null;
        composer.setProvider(parked.provider);
        if (parked.model) composer.setModel(parked.model);
      }
      return;
    }

    if (!parkedPick.current) {
      parkedPick.current = { provider: composer.provider, model: composer.model };
    }
    const target = useGraphStore.getState().nodes[regenerateNodeId];
    if (
      target &&
      isProvider(target.provider) &&
      connectedKey.split(",").includes(target.provider)
    ) {
      composer.setProvider(target.provider);
      composer.setModel(target.model);
    }

    const field = textareaRef.current;
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        document.querySelector(
          '[data-slot="dialog-content"], [data-slot="sheet-content"]',
        )
      ) {
        return;
      }
      composer.setRegenerateNode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [regenerateNodeId, connectedKey]);

  function regenerate() {
    if (sending) return;
    const text = prompt.trim();
    if (!text || !provider || !regenerateNodeId) return;

    setSending(true);
    chat
      .mutateAsync({
        request: {
          regenerateNodeId,
          prompt: text,
          provider,
          model: model ?? defaultModel(provider),
        },
        onNode: (node) => {
          setSending(false);
          setRegenerateNode(null);
          useGraphStore.getState().setSuggestions(node.id, []);
        },
        onTitled: (_nodeId, isRoot) => {
          if (isRoot) router.refresh();
        },
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setSending(false));
  }

  function submit() {
    if (regenerateNodeId) {
      regenerate();
      return;
    }
    if (sending) return;
    const text = prompt.trim();
    if (!text || !provider) return;

    const graph = useGraphStore.getState();
    if (!graph.conversationId) return;
    const allNodes = Object.values(graph.nodes);
    const parentNode = graph.selectedNodeId
      ? graph.nodes[graph.selectedNodeId]
      : undefined;

    const contextNodeIds = parentNode
      ? Object.entries(checked)
          .filter(([id, v]) => v && graph.nodes[id])
          .map(([id]) => id)
      : [];
    const position = parentNode
      ? childPosition(parentNode, allNodes)
      : rootPosition(allNodes);

    setPrompt("");
    setSending(true);

    chat
      .mutateAsync({
        request: {
          conversationId: graph.conversationId,
          parentId: parentNode?.id ?? null,
          contextNodeIds,
          prompt: text,
          provider,
          model: model ?? defaultModel(provider),
          canvasX: position.x,
          canvasY: position.y,
        },
        onNode: () => setSending(false),
        onTitled: (_nodeId, isRoot) => {
          if (isRoot) router.refresh();
        },
      })
      .catch((error: Error) => {
        toast.error(error.message);
        setPrompt((current) => (current === "" ? text : current));
      })
      .finally(() => setSending(false));
  }

  if (!hasKey) {
    return (
      <div className="rounded-xl border bg-card p-4 text-center shadow-lg">
        <p className="text-sm text-muted-foreground">
          Connect an OpenAI, Anthropic, or OpenRouter API key to start
          prompting.
        </p>
        <Button
          size="sm"
          className="mt-2"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          Add a key in Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 shadow-lg">
      {centered && (
        <p className="px-1 text-center text-sm text-muted-foreground">
          Ask anything — your first card lands on the canvas.
        </p>
      )}

      {regenerateTarget ? (
        <div className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] text-muted-foreground">
          <RefreshCw className="size-3 shrink-0 text-primary" />
          Regenerating
          <span className="max-w-40 truncate font-medium text-foreground">
            {regenerateTarget.title ?? regenerateTarget.prompt}
          </span>
          — its answer is replaced in place.
          <button
            type="button"
            title="Cancel regeneration (Esc)"
            onClick={() => setRegenerateNode(null)}
            className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : parent ? (
        <>
          <p className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <GitBranch className="size-3" />
            Branching from
            <span className="max-w-56 truncate font-medium text-foreground">
              {parent.title ?? parent.prompt}
            </span>
          </p>
          <ContextPicker
            parent={parent}
            checked={checked}
            onToggle={(id, value) =>
              setChecked((prev) => ({ ...prev, [id]: value }))
            }
          />
        </>
      ) : (
        !centered && (
          <p className="px-1 text-[11px] text-muted-foreground">
            No card selected — this prompt starts a new root. Select a card to
            branch from it.
          </p>
        )
      )}

      <Textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          regenerateNodeId
            ? "Edit the prompt and regenerate, or Esc to cancel"
            : "Prompt… (Enter to send, Shift+Enter for a new line)"
        }
        className="max-h-40 min-h-16 resize-none"
      />

      <div className="flex items-center gap-2">
        <Select
          value={provider}
          onValueChange={(value) => {
            if (typeof value === "string" && isProvider(value)) {
              setProvider(value as Provider);
            }
          }}
        >
          <SelectTrigger size="sm" className="w-auto text-xs">
            <SelectValue>{provider ? providerLabel(provider) : "Model"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {connectedProviders.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {providerLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {provider && hasModelCatalog(provider) && (
          <ModelPicker
            provider={provider}
            value={model ?? defaultModel(provider)}
            onChange={setModel}
          />
        )}
        <Button
          size="sm"
          className="ml-auto"
          onClick={submit}
          disabled={!prompt.trim() || sending}
        >
          {regenerateNodeId ? (
            <>
              <RefreshCw className="size-4" />
              Regenerate
            </>
          ) : (
            <>
              <ArrowUp className="size-4" />
              Send
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
