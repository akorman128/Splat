"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { Button } from "@/components/ui/button";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import type { SharedConversation } from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), { ssr: false });

export function SharedConversationView({ shared }: { shared: SharedConversation }) {
  const { conversation, nodes, edges, suggestions } = shared;
  const initialized = useGraphStore(
    (s) => s.conversationId === conversation.id && s.readOnly,
  );

  useEffect(() => {
    useGraphStore.getState().init({
      conversationId: conversation.id,
      nodes,
      edges,
      suggestions,
      readOnly: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          🫟 Splat
        </Link>
        <span className="truncate text-sm text-muted-foreground">
          {conversation.title}
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
          <Eye className="size-3" />
          View only
        </span>
        <Button
          size="sm"
          className="ml-auto shrink-0"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Try Splat
        </Button>
      </header>
      <div className="relative flex-1 overflow-hidden">
        {!initialized ? null : nodes.length > 0 ? (
          <>
            <Canvas />
            <ExpandedCardOverlay />
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            This conversation has no cards yet.
          </div>
        )}
      </div>
    </div>
  );
}
