"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, GitBranch } from "lucide-react";
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
import { submitChat } from "@/lib/chat-client";
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

/**
 * A fixed-model provider names its model right in the dropdown. A catalogue
 * provider cannot — the model is a separate choice, made in the ModelPicker
 * beside it — so repeating a model id here would just contradict it.
 */
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
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const provider = useComposerStore((s) => s.provider);
  const setProvider = useComposerStore((s) => s.setProvider);
  const model = useComposerStore((s) => s.model);
  const setModel = useComposerStore((s) => s.setModel);
  const parent = useGraphStore((s) =>
    s.selectedNodeId ? s.nodes[s.selectedNodeId] : undefined,
  );

  const connectedProviders = credentials.map((c) => c.provider);
  const hasKey = connectedProviders.length > 0;

  // Keep the (zustand-held) provider selection valid for this account.
  useEffect(() => {
    if (!provider || !connectedProviders.includes(provider)) {
      setProvider(connectedProviders[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials.map((c) => c.provider).join(",")]);

  // Default context: the full ancestor path from the selected card to root.
  // Recomputed when the selected parent changes (adjust-state-during-render).
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

  function submit() {
    // Guard against a second submission before the first node exists. Both
    // calls would otherwise read the same node set, so childPosition/
    // rootPosition would hand them identical coordinates and one card would
    // sit exactly on top of the other, invisible. Released on the "node"
    // event rather than at end-of-stream, so branching stays responsive.
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
          .filter(([, v]) => v)
          .map(([id]) => id)
      : [];
    const position = parentNode
      ? childPosition(parentNode, allNodes)
      : rootPosition(allNodes);

    setPrompt("");
    setSending(true);

    void submitChat(
      {
        conversationId: graph.conversationId,
        parentId: parentNode?.id ?? null,
        contextNodeIds,
        prompt: text,
        provider,
        model: model ?? defaultModel(provider),
        canvasX: position.x,
        canvasY: position.y,
      },
      {
        onNode: () => setSending(false),
        onTitled: (_nodeId, isRoot) => {
          // A root card's title becomes the conversation title — refresh the
          // sidebar to pick it up.
          if (isRoot) router.refresh();
        },
      },
    ).then(({ error }) => {
      // Also clears when the request failed before any node event arrived.
      setSending(false);
      if (error) {
        toast.error(error);
        setPrompt((current) => (current === "" ? text : current));
      }
    });
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

      {parent ? (
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
        placeholder="Prompt… (Enter to send, Shift+Enter for a new line)"
        className="max-h-40 min-h-16 resize-none"
      />

      <div className="flex items-center gap-2">
        <Select
          value={provider ?? undefined}
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
          <ArrowUp className="size-4" />
          Send
        </Button>
      </div>
    </div>
  );
}
