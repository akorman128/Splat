"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronUp } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useAttachmentStore } from "@/lib/store/attachment-store";
import { sweepAttachments } from "@/lib/attachments-client";
import { Composer } from "@/components/composer/Composer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { modifierLabel } from "@/lib/shortcuts";
import { CanvasSpinner } from "./CanvasSpinner";
import { CardOutline } from "./CardOutline";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { DeleteNodeDialog } from "./DeleteNodeDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type {
  CardAttachment,
  ContextEdgeRow,
  CredentialSummary,
  NodeRow,
  SkillSummary,
  SuggestionRow,
} from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), {
  ssr: false,
  loading: () => <CanvasSpinner />,
});

export function ConversationView({
  conversationId,
  nodes,
  edges,
  suggestions,
  attachments,
  credentials,
  skills,
}: {
  conversationId: string | null;
  nodes: NodeRow[];
  edges: ContextEdgeRow[];
  suggestions: SuggestionRow[];
  attachments: CardAttachment[];
  credentials: CredentialSummary[];
  skills: SkillSummary[];
}) {
  const router = useRouter();
  const storeConversationId = useGraphStore((s) => s.conversationId);
  const storeHasNodes = useGraphStore((s) => Object.keys(s.nodes).length > 0);
  const adopted = useGraphStore((s) => s.adopted);
  const draftRoute = conversationId === null;
  const initialized = draftRoute || storeConversationId === conversationId;
  // On the draft route the store can still hold the conversation this one was
  // opened from, whose cards belong to a route that is being left. Only a
  // conversation adopted here — by a file attached, or by the first card
  // streaming in — has cards this route should draw.
  const hasNodes = storeHasNodes && (!draftRoute || adopted);
  const regenerateNodeId = useComposerStore((s) => s.regenerateNodeId);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [composerHidden, setComposerHidden] = useState(false);

  const toggleComposer = useCallback(() => {
    if (!hasNodes) return;
    setComposerHidden((hidden) => !hidden);
  }, [hasNodes]);

  useKeyboardShortcuts({ shortcutsOpen, setShortcutsOpen, toggleComposer });

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

  useEffect(() => {
    const graph = useGraphStore.getState();
    // Skip if the store already adopted this id — a draft's first card streaming
    // in, or a file attached before the first prompt. Re-initing would wipe the
    // card mid-stream, and the reset would drop the chips that created the
    // conversation in the first place.
    if (graph.conversationId !== conversationId) {
      graph.init({ conversationId, nodes, edges, suggestions, attachments });
      useComposerStore.getState().setRegenerateNode(null);
      useAttachmentStore.getState().reset();
    }
    if (conversationId) sweepAttachments(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Attaching a file on the draft route writes the conversation before any card
  // exists, so the address bar has to catch up — otherwise a reload lands back
  // on an empty /c/new and the sidebar never shows the new conversation. Read the
  // adopted id off the store rather than out of the closure: arriving here from
  // another conversation, the closure still holds that one, and only the effect
  // above has cleared it by the time this runs.
  useEffect(() => {
    if (!draftRoute) return;
    const adopted = useGraphStore.getState().conversationId;
    if (!adopted) return;
    router.replace(`/c/${adopted}`);
    router.refresh();
  }, [draftRoute, storeConversationId, router]);

  if (!initialized) return <CanvasSpinner />;

  const showLabel = `Show the prompt box (${modifierLabel()}H)`;

  return (
    <div className="relative flex-1 overflow-hidden">
      {hasNodes ? (
        <>
          <Canvas />
          <CardOutline />
          <div
            data-composer-bar
            className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4"
          >
            <div className="w-full max-w-2xl">
              {composerHidden && (
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
              <div className={cn("pointer-events-auto", composerHidden && "hidden")}>
                <Composer
                  credentials={credentials}
                  skills={skills}
                  onHide={toggleComposer}
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <Composer credentials={credentials} skills={skills} centered />
          </div>
        </div>
      )}
      <ExpandedCardOverlay />
      <DeleteNodeDialog />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
