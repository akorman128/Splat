"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { AnnotationsPanel } from "@/components/highlights/AnnotationsPanel";
import { Button } from "@/components/ui/button";
import { CanvasSpinner } from "./CanvasSpinner";
import { CardOutline } from "./CardOutline";
import { ChatView } from "./ChatView";
import { ExpandedCardOverlay } from "./ExpandedCardOverlay";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { SharedConversation } from "@/lib/types";

const Canvas = dynamic(() => import("./Canvas"), {
  ssr: false,
  loading: () => <CanvasSpinner />,
});

export function SharedConversationView({ shared }: { shared: SharedConversation }) {
  const { conversation, nodes, edges, suggestions, attachments, highlights } =
    shared;
  const hasNodes = nodes.length > 0;
  const initialized = useGraphStore(
    (s) => s.conversationId === conversation.id && s.readOnly,
  );
  const chatOpen = useGraphStore((s) => s.chatOpen);
  const closeChat = useGraphStore((s) => s.closeChat);
  const annotationsOpen = useGraphStore((s) => s.annotationsOpen);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    useGraphStore.getState().init({
      conversationId: conversation.id,
      nodes,
      edges,
      suggestions,
      attachments: attachments ?? [],
      highlights: highlights ?? [],
      readOnly: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const toggleChat = useCallback(() => {
    if (!hasNodes) return;
    const graph = useGraphStore.getState();
    if (graph.chatOpen) graph.closeChat();
    else graph.openChat();
  }, [hasNodes]);

  const toggleAnnotations = useCallback(() => {
    if (!hasNodes) return;
    const graph = useGraphStore.getState();
    if (graph.annotationsOpen) graph.closeAnnotations();
    else graph.openAnnotations();
  }, [hasNodes]);

  useKeyboardShortcuts({
    shortcutsOpen,
    setShortcutsOpen,
    chatOpen,
    toggleChat,
    toggleAnnotations,
  });

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
      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {!initialized ? (
            <CanvasSpinner />
          ) : hasNodes ? (
            <>
              <Canvas />
              <CardOutline />
              {chatOpen && <ChatView onClose={closeChat} />}
              <ExpandedCardOverlay />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              This conversation has no cards yet.
            </div>
          )}
          <ShortcutsSheet
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            readOnly
          />
        </div>
        {initialized && hasNodes && annotationsOpen && <AnnotationsPanel />}
      </div>
    </div>
  );
}
