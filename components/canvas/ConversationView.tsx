"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useGraphStore } from "@/lib/store/graph-store";
import { Composer } from "@/components/composer/Composer";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import type {
  ContextEdgeRow,
  CredentialSummary,
  NodeRow,
  SuggestionRow,
} from "@/lib/types";

// tldraw touches window at import time — client-only.
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

  useEffect(() => {
    useGraphStore
      .getState()
      .init({ conversationId, nodes, edges, suggestions });
    // Re-init only when switching conversations; while it's open, the client
    // stores are the live copy (streaming, new nodes) and server re-renders
    // must not clobber them.
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
        // Empty conversation: a centered composer — nothing else.
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <Composer credentials={credentials} centered />
          </div>
        </div>
      )}
      <ExpandedCardOverlay />
    </div>
  );
}
