"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUp,
  ChevronDown,
  GitBranch,
  Paperclip,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { ContextPicker } from "./ContextPicker";
import { ModelPicker } from "./ModelPicker";
import { SkillMenu, matchSkills, skillTriggerAt, type SkillTrigger } from "./SkillMenu";
import { AttachmentChips } from "./AttachmentChips";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import {
  readyAttachmentIds,
  useAttachmentStore,
} from "@/lib/store/attachment-store";
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
import { MAX_ATTACHMENTS_PER_TURN } from "@/lib/attachments/types";
import { modifierLabel } from "@/lib/shortcuts";
import type { CredentialSummary, SkillSummary } from "@/lib/types";

function providerLabel(provider: Provider): string {
  return hasModelCatalog(provider)
    ? PROVIDER_LABELS[provider]
    : conversationModelLabel(provider);
}

// Drafts and ticked ancestor files reach the route as one list measured
// against one cap. Counting them apart is how a send ends in a 400 with no
// chip and no checkbox to point at, so the composer counts them together —
// uploads still in flight included, because they will be ready by the time
// Send is pressed, and ticks whose owning card is gone excluded, because they
// have no row left to send.
function turnAttachmentCount(
  checkedAttachments: Record<string, boolean>,
): number {
  const live = new Set(
    Object.values(useGraphStore.getState().attachments).flatMap((list) =>
      list.map((a) => a.id),
    ),
  );
  const ticked = Object.entries(checkedAttachments).filter(
    ([id, value]) => value && live.has(id),
  ).length;
  const drafts = useAttachmentStore
    .getState()
    .drafts.filter((d) => d.status !== "error").length;
  return drafts + ticked;
}

export function Composer({
  credentials,
  skills,
  centered = false,
  onHide,
}: {
  credentials: CredentialSummary[];
  skills: SkillSummary[];
  centered?: boolean;
  onHide?: () => void;
}) {
  const router = useRouter();
  const chat = useChatStream();
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [attached, setAttached] = useState<SkillSummary[]>([]);
  const [trigger, setTrigger] = useState<SkillTrigger | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Attachments owned by cards in context, re-checked for this turn. Empty is
  // the answer that matters: a file rides along on the turn it was attached and
  // never again unless someone asks for it back.
  const [checkedAttachments, setCheckedAttachments] = useState<
    Record<string, boolean>
  >({});
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const drafts = useAttachmentStore((s) => s.drafts);
  const uploading = drafts.some((d) => d.status === "uploading");

  const matches = useMemo(
    () =>
      trigger
        ? matchSkills(
            skills,
            trigger.query,
            attached.map((s) => s.id),
          )
        : [],
    [trigger, skills, attached],
  );
  const menuOpen = matches.length > 0;

  function attach(skill: SkillSummary) {
    if (!trigger) return;
    const caret = trigger.from;
    setPrompt(prompt.slice(0, trigger.from) + prompt.slice(trigger.to));
    setAttached((current) => [...current, skill]);
    setTrigger(null);
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  }

  function detach(skillId: string) {
    setAttached((current) => current.filter((s) => s.id !== skillId));
  }

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
    setCheckedAttachments({});
    if (!parent) {
      setChecked({});
    } else {
      const graph = useGraphStore.getState();
      const chain = parentChain(parent.id, Object.values(graph.nodes));
      setChecked(Object.fromEntries(chain.map((id) => [id, true])));
    }
  }

  const [parkedDraft, setParkedDraft] = useState("");
  const [parkedSkills, setParkedSkills] = useState<SkillSummary[]>([]);
  const [lastRegenerateId, setLastRegenerateId] = useState<string | null>(null);
  if (regenerateNodeId !== lastRegenerateId) {
    setLastRegenerateId(regenerateNodeId);
    setTrigger(null);
    if (regenerateNodeId) {
      if (lastRegenerateId === null) {
        setParkedDraft(prompt);
        setParkedSkills(attached);
      }
      setPrompt(useGraphStore.getState().nodes[regenerateNodeId]?.prompt ?? "");
      setAttached([]);
    } else {
      setPrompt(parkedDraft);
      setAttached(parkedSkills);
      setParkedDraft("");
      setParkedSkills([]);
    }
  }

  // The skills a card was made with, so a regeneration starts from the same set
  // and can be edited before it runs. A skill deleted since then has no id left
  // to re-send and drops out of the set.
  useEffect(() => {
    if (!regenerateNodeId) return;
    let active = true;
    void createClient()
      .from("node_skills")
      .select("skill_id, name")
      .eq("node_id", regenerateNodeId)
      .order("position")
      .then(({ data }) => {
        if (!active || !data) return;
        setAttached(
          data
            .filter((row) => row.skill_id !== null)
            .map((row) => ({ id: row.skill_id as string, name: row.name })),
        );
      });
    return () => {
      active = false;
    };
  }, [regenerateNodeId]);

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
          skillIds: attached.map((s) => s.id),
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

    // Enter reaches submit() without passing the Send button, so the guard has
    // to live here too: sending mid-upload would quietly leave the file out of
    // the very prompt it was attached to, and the model would answer about a
    // document it never received.
    if (useAttachmentStore.getState().drafts.some((d) => d.status === "uploading")) {
      toast.error("Still uploading — one moment.");
      return;
    }

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
    // Drafts are what this card is about to own; the checked ones are older
    // files being replayed. The route tells them apart by node_id, so they can
    // travel as one list.
    //
    // The checked set is filtered against what still exists for the same reason
    // contextNodeIds is: deleting the card that owned a ticked file leaves its
    // id checked with no row and no checkbox to untick, and the route answers
    // every subsequent send with a 400.
    const liveAttachmentIds = new Set(
      Object.values(graph.attachments).flatMap((list) =>
        list.map((a) => a.id),
      ),
    );
    const attachmentIds = [
      ...readyAttachmentIds(useAttachmentStore.getState().drafts),
      ...Object.entries(checkedAttachments)
        .filter(([id, value]) => value && liveAttachmentIds.has(id))
        .map(([id]) => id),
    ];
    // The route counts the same list and answers 400, which arrives as a
    // failed send with the prompt handed back and nothing to act on.
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_TURN) {
      toast.error(
        `This prompt carries ${attachmentIds.length} files — the limit is ${MAX_ATTACHMENTS_PER_TURN}. Remove a chip or untick a file.`,
      );
      return;
    }
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
          skillIds: attached.map((s) => s.id),
          attachmentIds,
          prompt: text,
          provider,
          model: model ?? defaultModel(provider),
          canvasX: position.x,
          canvasY: position.y,
        },
        onNode: () => {
          setSending(false);
          // The card owns them now — the composer lets go rather than deleting,
          // which would take the card's own files with it. Only the ones that
          // actually went: a file dropped while this card was streaming is not
          // part of it and keeps its chip.
          useAttachmentStore.getState().released(attachmentIds);
          setCheckedAttachments({});
        },
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

  // A regeneration replays the card's own files; there is nothing to attach to
  // an answer being rewritten in place.
  const attachable = !regenerateNodeId;

  // No `attachable` guard: enqueue already refuses a file mid-regeneration and
  // says why, which is better than a drop that lands nowhere and explains
  // nothing.
  function pick(files: File[], synthesiseNames = false) {
    if (files.length === 0) return;
    useAttachmentStore.getState().enqueue(files, { synthesiseNames });
  }

  return (
    <div
      className={cn(
        "relative space-y-2 rounded-xl border bg-card p-3 shadow-lg",
        dragging && "ring-2 ring-primary",
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        // Unconditionally, even when nothing here will take the file: a
        // dragover that is not prevented leaves the browser to handle the
        // drop, and the browser navigates to the file — taking the canvas
        // with it. The composer sits outside the tldraw container, so its own
        // guards never see this drag.
        event.preventDefault();
        if (attachable) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(false);
        pick(Array.from(event.dataTransfer.files));
      }}
    >
      {onHide && (
        <Button
          variant="ghost"
          size="icon-xs"
          title={`Hide the prompt box (${modifierLabel()}H)`}
          onClick={onHide}
          className="absolute top-1.5 right-1.5 text-muted-foreground"
        >
          <ChevronDown />
          <span className="sr-only">Hide the prompt box</span>
        </Button>
      )}

      {centered && (
        <p className="px-1 text-center text-sm text-muted-foreground">
          Ask anything — your first card lands on the canvas.
        </p>
      )}

      {attached.length > 0 && (
        <div className={cn("flex flex-wrap gap-1 px-1", onHide && "pr-7")}>
          {attached.map((skill) => (
            <span
              key={skill.id}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 py-0.5 pr-1 pl-2 text-[11px] font-medium"
            >
              <Sparkles className="size-3 text-primary" />
              {skill.name}
              <button
                type="button"
                title={`Remove ${skill.name}`}
                onClick={() => detach(skill.id)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
                <span className="sr-only">Remove {skill.name}</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {regenerateTarget ? (
        <div
          className={cn(
            "flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] text-muted-foreground",
            onHide && "pr-7",
          )}
        >
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
            checkedAttachments={checkedAttachments}
            onToggleAttachment={(id, value) => {
              if (
                value &&
                turnAttachmentCount(checkedAttachments) >=
                  MAX_ATTACHMENTS_PER_TURN
              ) {
                toast.error(
                  `A prompt can carry ${MAX_ATTACHMENTS_PER_TURN} files — remove one to send this.`,
                );
                return;
              }
              setCheckedAttachments((prev) => ({ ...prev, [id]: value }));
            }}
          />
        </>
      ) : (
        !centered && (
          <p
            className={cn(
              "px-1 text-[11px] text-muted-foreground",
              onHide && "pr-7",
            )}
          >
            No card selected — this prompt starts a new root. Select a card to
            branch from it.
          </p>
        )
      )}

      <AttachmentChips />

      <div className="relative">
        {menuOpen && (
          <SkillMenu
            matches={matches}
            highlight={highlight}
            onHighlight={setHighlight}
            onPick={attach}
          />
        )}
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setTrigger(
              skillTriggerAt(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              ),
            );
            setHighlight(0);
          }}
          onBlur={() => setTrigger(null)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length === 0) return;
            // A screenshot arrives as "image.png" every single time, so three
            // pastes would give three identical chips. Real files keep their
            // names.
            const anonymous = files.every(
              (file) => !file.name || /^image\.\w+$/i.test(file.name),
            );
            // Copying a range out of a spreadsheet or a document puts a
            // rendered picture of the selection on the clipboard beside the
            // text itself. The text is what the paste was for, and swallowing
            // it to attach a screenshot of itself is not a trade anyone asked
            // for. A screenshot proper carries no text, and a file copied in
            // Finder carries its own name, so neither is caught by this.
            if (anonymous && e.clipboardData.getData("text/plain").trim()) {
              return;
            }
            e.preventDefault();
            pick(files, anonymous);
          }}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % matches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + matches.length) % matches.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                attach(matches[highlight] ?? matches[0]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setTrigger(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            regenerateNodeId
              ? "Edit the prompt and regenerate, or Esc to cancel"
              : skills.length > 0
                ? "Prompt… (Enter to send, / for a skill)"
                : "Prompt… (Enter to send, Shift+Enter for a new line)"
          }
          className="max-h-40 min-h-16 resize-none"
        />
      </div>

      <div className="flex items-center gap-2">
        {attachable && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              title="Attach a file (or drop one anywhere on the canvas)"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
              <span className="sr-only">Attach a file</span>
            </Button>
          </>
        )}
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
          title={uploading ? "Waiting for the upload to finish" : undefined}
          onClick={submit}
          disabled={!prompt.trim() || sending || uploading}
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
