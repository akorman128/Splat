"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { Composer } from "@/components/composer/Composer";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { DeleteNodeDialog } from "./DeleteNodeDialog";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type {
  ContextEdgeRow,
  CredentialSummary,
  NodeRow,
  SuggestionRow,
} from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), { ssr: false });

export function ConversationView({
  conversationId,
  nodes,
  edges,
  suggestions,
  credentials,
}: {
  conversationId: string;
  nodes: NodeRow[];
  edges: ContextEdgeRow[];
  suggestions: SuggestionRow[];
  credentials: CredentialSummary[];
}) {
  const initialized = useGraphStore((s) => s.conversationId === conversationId);
  const hasNodes = useGraphStore((s) => Object.keys(s.nodes).length > 0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useKeyboardShortcuts({ shortcutsOpen, setShortcutsOpen });

  useEffect(() => {
    useGraphStore
      .getState()
      .init({ conversationId, nodes, edges, suggestions });
    useComposerStore.getState().setRegenerateNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  if (!initialized) return null;

  return (
    <div className="relative flex-1 overflow-hidden">
      {hasNodes ? (
        <>
          <Canvas />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4">
            <div className="pointer-events-auto w-full max-w-2xl">
              <Composer credentials={credentials} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <Composer credentials={credentials} centered />
          </div>
        </div>
      )}
      <ExpandedCardOverlay />
      <DeleteNodeDialog />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
