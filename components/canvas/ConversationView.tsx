"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronUp } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { Composer } from "@/components/composer/Composer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { modifierLabel } from "@/lib/shortcuts";
import { CanvasSpinner } from "./CanvasSpinner";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { DeleteNodeDialog } from "./DeleteNodeDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type {
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
  credentials,
  skills,
}: {
  conversationId: string;
  nodes: NodeRow[];
  edges: ContextEdgeRow[];
  suggestions: SuggestionRow[];
  credentials: CredentialSummary[];
  skills: SkillSummary[];
}) {
  const initialized = useGraphStore((s) => s.conversationId === conversationId);
  const hasNodes = useGraphStore((s) => Object.keys(s.nodes).length > 0);
  const regenerateNodeId = useComposerStore((s) => s.regenerateNodeId);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [composerHidden, setComposerHidden] = useState(false);

  // Only the floating composer can be hidden; the empty state is nothing but
  // the composer, so hiding it there would leave a blank page.
  const toggleComposer = useCallback(() => {
    if (!hasNodes) return;
    setComposerHidden((hidden) => !hidden);
  }, [hasNodes]);

  useKeyboardShortcuts({ shortcutsOpen, setShortcutsOpen, toggleComposer });

  const [lastRegenerateId, setLastRegenerateId] = useState<string | null>(null);
  if (regenerateNodeId !== lastRegenerateId) {
    setLastRegenerateId(regenerateNodeId);
    // A staged regeneration is edited in the composer — reveal it.
    if (regenerateNodeId) setComposerHidden(false);
  }

  useEffect(() => {
    useGraphStore
      .getState()
      .init({ conversationId, nodes, edges, suggestions });
    useComposerStore.getState().setRegenerateNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  if (!initialized) return <CanvasSpinner />;

  const showLabel = `Show the prompt box (${modifierLabel()}H)`;

  return (
    <div className="relative flex-1 overflow-hidden">
      {hasNodes ? (
        <>
          <Canvas />
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
