"use client";

import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useGraphStore } from "@/lib/store/graph-store";
import type { CardHighlight } from "@/lib/types";
import type { TextAnchor } from "./anchor";
import { HIGHLIGHT_COLUMNS, type HighlightColor } from "./palette";

// Written straight from the browser rather than through a route handler: RLS
// already owns the rule that a highlight belongs to its reader and hangs off
// one of their cards, and nothing here needs a decrypted API key. Same reason
// the settings toggles write their own row.
type Write = { data: CardHighlight | null; error: { message: string } | null };

async function apply(
  verb: string,
  run: () => PromiseLike<Write>,
): Promise<CardHighlight | null> {
  const { data, error } = await run();
  if (error || !data) {
    toast.error(`Could not ${verb}`, { description: error?.message });
    return null;
  }
  useGraphStore.getState().upsertHighlight(data);
  return data;
}

export function createHighlight(
  nodeId: string,
  anchor: TextAnchor,
  color: HighlightColor,
): Promise<CardHighlight | null> {
  return apply("save that highlight", () =>
    createClient()
      .from("highlights")
      .insert({
        node_id: nodeId,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        text_offset: anchor.textOffset,
        color,
      })
      .select(HIGHLIGHT_COLUMNS)
      .single(),
  );
}

export function saveNote(
  highlightId: string,
  note: string,
  model: string,
): Promise<CardHighlight | null> {
  return apply("save that response", () =>
    createClient()
      .from("highlights")
      .update({
        note,
        note_model: model,
        note_created_at: new Date().toISOString(),
        note_edited_at: null,
      })
      .eq("id", highlightId)
      .select(HIGHLIGHT_COLUMNS)
      .single(),
  );
}

// note_created_at is left alone: it says when the answer arrived, and
// note_edited_at is what says the words are no longer only the model's.
export function editNote(
  highlightId: string,
  note: string,
): Promise<CardHighlight | null> {
  return apply("save that edit", () =>
    createClient()
      .from("highlights")
      .update({ note, note_edited_at: new Date().toISOString() })
      .eq("id", highlightId)
      .select(HIGHLIGHT_COLUMNS)
      .single(),
  );
}

// The quote survives: deleting the note is deleting the note.
export function deleteNote(highlightId: string): Promise<CardHighlight | null> {
  return apply("delete that response", () =>
    createClient()
      .from("highlights")
      .update({
        note: null,
        note_model: null,
        note_created_at: null,
        note_edited_at: null,
      })
      .eq("id", highlightId)
      .select(HIGHLIGHT_COLUMNS)
      .single(),
  );
}

export async function deleteHighlight(
  nodeId: string,
  highlightId: string,
): Promise<boolean> {
  const { error } = await createClient()
    .from("highlights")
    .delete()
    .eq("id", highlightId);
  if (error) {
    toast.error("Could not remove that highlight", {
      description: error.message,
    });
    return false;
  }
  useGraphStore.getState().removeHighlight(nodeId, highlightId);
  return true;
}
