"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Link2 } from "lucide-react";
import {
  shareConversation,
  unshareConversation,
} from "@/app/(app)/c/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConversationSummary } from "./ConversationList";

export function ShareDialog({
  conversation,
  onTokenChange,
  onOpenChange,
}: {
  conversation: ConversationSummary | null;
  onTokenChange: (token: string | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // The dialog stays mounted between conversations, so its token follows
  // whichever one was opened last.
  const [shownId, setShownId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  if (conversation && conversation.id !== shownId) {
    setShownId(conversation.id);
    setToken(conversation.share_token);
    setCopied(false);
  }

  // Dialog content is only ever rendered on the client (a closed dialog
  // renders nothing), so the origin can be read straight off the browser.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = token ? `${origin}/s/${token}` : "";

  function create() {
    if (!conversation) return;
    startTransition(async () => {
      try {
        const minted = await shareConversation(conversation.id);
        setToken(minted);
        onTokenChange(minted);
        router.refresh();
      } catch (error) {
        toast.error("Could not create the link", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function revoke() {
    if (!conversation) return;
    startTransition(async () => {
      try {
        await unshareConversation(conversation.id);
        setToken(null);
        setCopied(false);
        onTokenChange(null);
        router.refresh();
        toast.success("Sharing stopped", {
          description: "The old link no longer opens this conversation.",
        });
      } catch (error) {
        toast.error("Could not stop sharing", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  }

  return (
    <Dialog open={conversation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share conversation</DialogTitle>
          <DialogDescription>
            Anyone with the link can view{" "}
            <span className="font-medium text-foreground">
              {conversation?.title}
            </span>{" "}
            — every card, its answer, and how the branches connect. They cannot
            edit it, add to it, or see anything else in your account.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="outline" onClick={copy} disabled={!url}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <Button onClick={create} disabled={pending}>
            <Link2 className="size-4" />
            {pending ? "Creating link…" : "Create link"}
          </Button>
        )}

        <DialogFooter>
          {token && (
            <Button variant="destructive" disabled={pending} onClick={revoke}>
              Stop sharing
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
