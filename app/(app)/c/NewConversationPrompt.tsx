"use client";

import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createFirstConversation } from "./actions";

// useFormStatus has to read the status of a form it sits *inside*, so the
// button is its own component.
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Plus className="size-4" />
      {pending ? "Creating…" : "New conversation"}
    </Button>
  );
}

/**
 * Empty state for a user with no conversations. The button POSTs a Server
 * Action; creation never happens as a side effect of rendering /c.
 */
export function NewConversationPrompt() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nothing on the canvas yet
        </h1>
        <p className="text-sm text-muted-foreground">
          Every prompt becomes a card you can branch from, with the context you
          choose. Start a conversation to place your first one.
        </p>
        <form action={createFirstConversation} className="flex justify-center">
          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
