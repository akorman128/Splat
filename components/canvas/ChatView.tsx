"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquareText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useSubmitSuggestion } from "@/lib/chat-actions";
import { siblingIds, threadOf } from "@/lib/graph/thread";
import { modifierLabel } from "@/lib/shortcuts";
import { ChatMessage } from "./ChatMessage";
import { useCardState } from "./useCardState";

// Up and down walk the thread; left and right swap the focused message's
// branch — the same directions the arrow keys mean on the canvas.
const ARROWS = {
  ArrowUp: { axis: "thread", delta: -1 },
  ArrowDown: { axis: "thread", delta: 1 },
  ArrowLeft: { axis: "branch", delta: -1 },
  ArrowRight: { axis: "branch", delta: 1 },
} as const;

const POPUPS =
  '[data-slot="dialog-content"], [data-slot="sheet-content"], [role="listbox"], [role="menu"]';

// Rects, not presence: base-ui parks a hidden listbox in the DOM even while
// every picker is closed.
function popupIsOpen(): boolean {
  for (const popup of document.querySelectorAll(POPUPS)) {
    if (popup.getClientRects().length > 0) return true;
  }
  return false;
}

// A field with something in it drives its own arrows, so the caret can move
// through a draft. An empty prompt box has no caret to move, and the keys go
// to the thread instead.
function fieldOwnsArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest(
    'input, textarea, [contenteditable="true"]',
  ) as HTMLElement | null;
  if (!field) return false;
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.value.length > 0;
  }
  return true;
}

// The canvas graph shown as one conversation. It draws the thread through the
// selected card and pins the selection to that thread's leaf, so the composer
// below — the same one the canvas uses — always replies at the end of what is
// on screen.
export function ChatView({
  onClose,
  composerHostRef,
}: {
  onClose(): void;
  composerHostRef(el: HTMLDivElement | null): void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const anchorNodeId = useGraphStore((s) => s.chatAnchorNodeId);
  const readOnly = useGraphStore((s) => s.readOnly);

  const thread = useMemo(
    () => threadOf(Object.values(nodes), anchorNodeId),
    [nodes, anchorNodeId],
  );
  const leafId = thread.length > 0 ? thread[thread.length - 1] : null;
  const rootTitle = thread.length > 0 ? nodes[thread[0]]?.title : undefined;

  // Which message the arrows and ⌘R act on. A request that a branch switch or
  // a deletion took out of the thread falls back to the leaf.
  const [focusRequest, setFocusRequest] = useState<string | null>(anchorNodeId);
  const focusedId =
    focusRequest && thread.includes(focusRequest) ? focusRequest : leafId;

  // Each message's place in its branch group, worked out here so a message
  // needs no view of the graph: subscribing every one of them to the node map
  // repaints the whole transcript on each streamed token.
  const branches = useMemo(() => {
    const all = Object.values(nodes);
    const map = new Map<
      string,
      { index: number; count: number; prev: string | null; next: string | null }
    >();
    for (const id of thread) {
      const group = siblingIds(all, id);
      const index = group.indexOf(id);
      map.set(id, {
        index,
        count: group.length,
        prev: group[index - 1] ?? null,
        next: group[index + 1] ?? null,
      });
    }
    return map;
  }, [nodes, thread]);

  // The composer replies at the end of what is on screen. This is separate
  // from the canvas selection so the canvas is untouched while the chat is up.
  const setReplyTarget = useGraphStore((s) => s.setReplyTarget);
  useEffect(() => {
    setReplyTarget(leafId);
    return () => setReplyTarget(null);
  }, [leafId, setReplyTarget]);

  const switchBranch = useCallback((nodeId: string) => {
    setFocusRequest(nodeId);
    useGraphStore.getState().setChatAnchor(nodeId);
  }, []);

  // The last card can be deleted out from under the view.
  useEffect(() => {
    if (!leafId) onClose();
  }, [leafId, onClose]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageAt = useCallback(
    (nodeId: string) =>
      scrollRef.current?.querySelector(`[data-message-id="${nodeId}"]`) ?? null,
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.shiftKey) return;
      if (popupIsOpen()) return;

      // ⌘R acts on the message holding focus. The canvas shortcut cannot: it
      // reads the selection, which no longer follows the thread.
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() !== "r" || !focusedId) return;
        const target = useGraphStore.getState().nodes[focusedId];
        if (!target || target.status === "streaming") return;
        event.preventDefault();
        event.stopPropagation();
        useComposerStore.getState().setRegenerateNode(target.id);
        return;
      }

      if (event.key === "Escape") {
        // A staged regeneration is the composer's to cancel first; Esc backs
        // out of the view only once nothing inside it is holding the key.
        if (useComposerStore.getState().regenerateNodeId) return;
        onClose();
        return;
      }

      if (!(event.key in ARROWS)) return;
      if (fieldOwnsArrows(event.target)) return;
      const step = ARROWS[event.key as keyof typeof ARROWS];
      const from = focusedId;
      if (!from) return;
      event.preventDefault();
      event.stopPropagation();

      if (step.axis === "thread") {
        const next = thread[thread.indexOf(from) + step.delta];
        if (next) setFocusRequest(next);
        return;
      }
      const group = branches.get(from);
      const next = step.delta < 0 ? group?.prev : group?.next;
      if (next) switchBranch(next);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, thread, focusedId, branches, switchBranch]);

  useEffect(() => {
    if (!focusRequest) return;
    messageAt(focusRequest)?.scrollIntoView({ block: "nearest" });
  }, [focusRequest, messageAt]);

  const openedRef = useRef(false);
  const prevThreadRef = useRef<string[]>([]);
  useEffect(() => {
    const el = scrollRef.current;
    const prev = prevThreadRef.current;
    prevThreadRef.current = thread;
    if (!el || thread.length === 0) return;

    // Opened from a card: start on that message. Otherwise start at the end,
    // where the conversation is.
    if (!openedRef.current) {
      openedRef.current = true;
      const anchored =
        anchorNodeId && anchorNodeId !== thread[thread.length - 1]
          ? messageAt(anchorNodeId)
          : null;
      if (anchored) anchored.scrollIntoView({ block: "center" });
      else el.scrollTop = el.scrollHeight;
      return;
    }
    // Scroll only for a message appended to the thread already on screen; a
    // branch switch replaces the tail and should keep the reader in place.
    const appended =
      thread.length > prev.length && prev.every((id, i) => thread[i] === id);
    if (appended) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread, anchorNodeId, messageAt]);

  const { responseText: leafText, isStreaming: leafStreaming } =
    useCardState(leafId);
  useEffect(() => {
    if (!leafStreaming) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      el.scrollTop = el.scrollHeight;
    }
  }, [leafStreaming, leafText.length]);

  const showOnCanvas = useCallback(
    (nodeId: string) => {
      onClose();
      const graph = useGraphStore.getState();
      graph.setSelectedNode(nodeId);
      graph.setFocusNode(nodeId);
    },
    [onClose],
  );

  const closeLabel = `Back to the canvas (${modifierLabel()}I)`;

  return (
    <div className="absolute inset-0 z-[45] flex flex-col bg-background animate-in fade-in-0 duration-150">
      <header className="flex shrink-0 items-center gap-2 border-b py-2 pr-4 pl-12">
        <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">
          {rootTitle ?? "Chat"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={closeLabel}
          onClick={onClose}
          className="ml-auto shrink-0"
        >
          <X />
          <span className="sr-only">{closeLabel}</span>
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-3xl space-y-8 py-6">
          {thread.map((id) => {
            const branch = branches.get(id);
            return (
              <ChatMessage
                key={id}
                nodeId={id}
                focused={id === focusedId}
                branchIndex={branch?.index ?? 0}
                branchCount={branch?.count ?? 1}
                prevBranchId={branch?.prev ?? null}
                nextBranchId={branch?.next ?? null}
                onFocus={setFocusRequest}
                onSwitchBranch={switchBranch}
                onShowOnCanvas={showOnCanvas}
              />
            );
          })}
          {!readOnly && leafId && <ChatSuggestions nodeId={leafId} />}
        </div>
      </div>

      {!readOnly && (
        <div className="shrink-0 px-4 pt-1 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <div ref={composerHostRef} />
          </div>
        </div>
      )}
    </div>
  );
}

function ChatSuggestions({ nodeId }: { nodeId: string }) {
  const suggestions = useGraphStore((s) => s.suggestions[nodeId]);
  const status = useGraphStore((s) => s.nodes[nodeId]?.status);
  const submit = useSubmitSuggestion();

  if (!suggestions || suggestions.length === 0 || status !== "complete") {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {suggestions.map((suggestion) => {
        const taken = suggestion.taken_at !== null;
        return (
          <button
            key={suggestion.id}
            type="button"
            disabled={taken || submit.isPending}
            onClick={() =>
              submit.mutate(suggestion, {
                onError: (error) => toast.error(error.message),
              })
            }
            className={`flex items-start gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs shadow-sm transition-colors ${
              taken
                ? "border-primary/40 bg-primary/10 text-muted-foreground"
                : "bg-card hover:bg-accent"
            }`}
          >
            {taken && <>✅</>}
            <span>{suggestion.text}</span>
          </button>
        );
      })}
    </div>
  );
}
