"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { ChevronUp } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useAttachmentStore } from "@/lib/store/attachment-store";
import { Composer } from "@/components/composer/Composer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { modifierLabel } from "@/lib/shortcuts";
import { CanvasSpinner } from "./CanvasSpinner";
import { CardOutline } from "./CardOutline";
import { ChatView } from "./ChatView";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { DeleteNodeDialog } from "./DeleteNodeDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { CredentialSummary, SkillSummary } from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), {
  ssr: false,
  loading: () => <CanvasSpinner />,
});

const noopSubscribe = () => () => {};

// Lives in the layout, above the segment that changes, so the first prompt on a
// draft can swap /c/new for /c/<id> without tearing the editor down. Everything
// here is drawn from the store; the route only says which conversation the page
// below is currently hydrating.
export function ConversationShell({
  credentials,
  skills,
  webSearchDefault,
  children,
}: {
  credentials: CredentialSummary[];
  skills: SkillSummary[];
  webSearchDefault: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useParams<{ conversationId?: string }>();
  const routeConversationId = params.conversationId ?? null;
  const draftRoute = routeConversationId === null;

  const storeConversationId = useGraphStore((s) => s.conversationId);
  const storeHasNodes = useGraphStore((s) => Object.keys(s.nodes).length > 0);
  const adopted = useGraphStore((s) => s.adopted);
  const initialized = draftRoute || storeConversationId === routeConversationId;
  // On the draft route the store can still hold the conversation this one was
  // opened from, whose cards belong to a route that is being left. Only a
  // conversation adopted here — by a file attached, or by the first card
  // streaming in — has cards this route should draw.
  const hasNodes = storeHasNodes && (!draftRoute || adopted);
  // Only when there is nothing to look at. Switching conversations leaves the
  // previous canvas up until the next one's rows arrive, rather than blanking.
  const loading = !initialized && !storeHasNodes;
  const regenerateNodeId = useComposerStore((s) => s.regenerateNodeId);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [composerHidden, setComposerHidden] = useState(false);
  // In the store rather than here: a card's own chat button opens this, and it
  // is drawn inside tldraw where the shell's state is out of reach.
  const chatOpen = useGraphStore((s) => s.chatOpen);
  const closeChat = useGraphStore((s) => s.closeChat);
  // The composer lives in this detached node for its whole life and the node is
  // moved between the bottom bar and the chat view. Re-targeting a portal at a
  // different container would remount the composer and drop the draft. Created
  // only after hydration: the server has no portal, so the first client render
  // must not have one either.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const composerNode = useMemo(
    () => (hydrated ? document.createElement("div") : null),
    [hydrated],
  );
  const [barHost, setBarHost] = useState<HTMLDivElement | null>(null);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);

  // A conversation emptied under an open chat leaves nothing to draw.
  useEffect(() => {
    if (!hasNodes && chatOpen) closeChat();
  }, [hasNodes, chatOpen, closeChat]);

  const toggleComposer = useCallback(() => {
    if (!hasNodes) return;
    setComposerHidden((hidden) => !hidden);
  }, [hasNodes]);

  const toggleChat = useCallback(() => {
    if (!hasNodes) return;
    const graph = useGraphStore.getState();
    if (graph.chatOpen) graph.closeChat();
    else graph.openChat();
  }, [hasNodes]);

  useKeyboardShortcuts({
    shortcutsOpen,
    setShortcutsOpen,
    toggleComposer,
    chatOpen,
    toggleChat,
  });

  useLayoutEffect(() => {
    const host = chatOpen && chatHost ? chatHost : barHost;
    if (!composerNode || !host || host === composerNode.parentElement) return;
    host.appendChild(composerNode);
    if (chatOpen) {
      composerNode.querySelector("textarea")?.focus();
    }
  }, [composerNode, chatOpen, chatHost, barHost]);

  const [lastRegenerateId, setLastRegenerateId] = useState<string | null>(null);
  if (regenerateNodeId !== lastRegenerateId) {
    setLastRegenerateId(regenerateNodeId);
    if (regenerateNodeId) setComposerHidden(false);
  }

  const draftCount = useAttachmentStore((s) => s.drafts.length);
  const [lastDraftCount, setLastDraftCount] = useState(0);
  if (draftCount !== lastDraftCount) {
    setLastDraftCount(draftCount);
    if (draftCount > lastDraftCount) setComposerHidden(false);
  }

  // A conversation is written before the address bar knows about it: by the
  // first card streaming in, or by a file attached ahead of any prompt. Without
  // this a reload lands back on an empty /c/new and the sidebar never shows it.
  // Read the adopted id off the store rather than out of the closure: arriving
  // here from another conversation the closure still holds that one, and only
  // the hydrator below has cleared it by the time this runs.
  useEffect(() => {
    if (!draftRoute) return;
    const adopted = useGraphStore.getState().conversationId;
    if (!adopted) return;
    router.replace(`/c/${adopted}`);
    router.refresh();
  }, [draftRoute, storeConversationId, router]);

  const showLabel = `Show the prompt box (${modifierLabel()}H)`;

  return (
    <div className="relative flex-1 overflow-hidden">
      {children}
      {loading ? (
        <CanvasSpinner />
      ) : (
        <>
          {hasNodes && (
            <>
              <Canvas />
              <CardOutline />
            </>
          )}
          <div
            data-composer-bar={hasNodes || undefined}
            className={cn(
              hasNodes
                ? "pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4"
                : "flex h-full items-center justify-center p-6",
            )}
          >
            <div className={cn("w-full", hasNodes ? "max-w-2xl" : "max-w-xl")}>
              {hasNodes && composerHidden && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title={showLabel}
                    onClick={toggleComposer}
                    className="pointer-events-auto shadow-lg"
                  >
                    <ChevronUp />
                    <span className="sr-only">{showLabel}</span>
                  </Button>
                </div>
              )}
              <div
                ref={setBarHost}
                className={cn(
                  hasNodes && "pointer-events-auto",
                  hasNodes && composerHidden && "hidden",
                )}
              />
            </div>
          </div>
        </>
      )}
      {hasNodes && chatOpen && (
        <ChatView onClose={closeChat} composerHostRef={setChatHost} />
      )}
      {composerNode &&
        createPortal(
          <Composer
            credentials={credentials}
            skills={skills}
            webSearchDefault={webSearchDefault}
            centered={!hasNodes}
            onHide={hasNodes && !chatOpen ? toggleComposer : undefined}
          />,
          composerNode,
        )}
      <ExpandedCardOverlay />
      <DeleteNodeDialog />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
