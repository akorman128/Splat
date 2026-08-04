"use client";

import { useCallback, useEffect, useState } from "react";
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
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { DeleteNodeDialog } from "./DeleteNodeDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { CredentialSummary, SkillSummary } from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), {
  ssr: false,
  loading: () => <CanvasSpinner />,
});

// Lives in the layout, above the segment that changes, so the first prompt on a
// draft can swap /c/new for /c/<id> without tearing the editor down. Everything
// here is drawn from the store; the route only says which conversation the page
// below is currently hydrating.
export function ConversationShell({
  credentials,
  skills,
  children,
}: {
  credentials: CredentialSummary[];
  skills: SkillSummary[];
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
                className={cn(
                  hasNodes && "pointer-events-auto",
                  hasNodes && composerHidden && "hidden",
                )}
              >
                <Composer
                  credentials={credentials}
                  skills={skills}
                  centered={!hasNodes}
                  onHide={hasNodes ? toggleComposer : undefined}
                />
              </div>
            </div>
          </div>
        </>
      )}
      <ExpandedCardOverlay />
      <DeleteNodeDialog />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
