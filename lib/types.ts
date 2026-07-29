import type { Database } from "@/lib/supabase/types";
import type { Provider } from "@/lib/providers/models";

export type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
export type ContextEdgeRow =
  Database["public"]["Tables"]["context_edges"]["Row"];
export type SuggestionRow = Database["public"]["Tables"]["suggestions"]["Row"];
export type ConversationRow =
  Database["public"]["Tables"]["conversations"]["Row"];
export type SkillRow = Database["public"]["Tables"]["skills"]["Row"];
export type NodeSkillRow = Database["public"]["Tables"]["node_skills"]["Row"];
export type AttachmentRow = Database["public"]["Tables"]["attachments"]["Row"];
export type NodeAttachmentRow =
  Database["public"]["Tables"]["node_attachments"]["Row"];

// Matches the column default. A conversation still carrying it has never been
// titled — by the user or by the root card's auto-title.
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

// Matches the column's check constraint.
export const MAX_SKILL_NAME_LENGTH = 60;

// What a card needs to render. The public share view is served a node without
// its owner's user_id, so nothing on the canvas may depend on that column.
export type CardNode = Omit<NodeRow, "user_id">;

// The same discipline for attachments, plus two columns the canvas must never
// carry: extracted_text is megabytes for a long PDF, and storage_path is minted
// into a signed URL server-side rather than handed to the browser. Dropping
// them is payload hygiene, not a security boundary — RLS still decides who may
// ask for the row.
export type CardAttachment = Omit<
  AttachmentRow,
  "user_id" | "storage_path" | "extracted_text"
>;

// The payload of the shared_conversation() RPC — one shared canvas, read-only.
// Its attachments are name-only: the storage policies are `to authenticated`,
// so an anonymous viewer cannot open the bytes behind a pill.
export type SharedConversation = {
  conversation: {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    shared_at: string;
  };
  nodes: CardNode[];
  edges: ContextEdgeRow[];
  suggestions: SuggestionRow[];
  attachments: CardAttachment[];
};

// What the composer needs to offer a skill in its "/" menu and show it as an
// attached chip. Instructions are left out so they don't ride along with every
// page load; the editor reads the one skill it opens, and the prompt is
// assembled from them server-side.
export type SkillSummary = {
  id: string;
  name: string;
};

// A skill as it was actually sent with a card: the live row when it still
// exists, the snapshot on node_skills when it doesn't.
export type AttachedSkill = {
  skillId: string | null;
  name: string;
  instructions: string;
};

export type CredentialSummary = {
  provider: Provider;
  key_last4: string;
};

export type NodeStatus = "pending" | "streaming" | "complete" | "error";

export type ChatStreamEvent =
  | {
      type: "node";
      node: NodeRow;
      edges: ContextEdgeRow[];
      // The drafts this card just claimed, so it renders its chips without a
      // refetch. Replayed ancestor files are not here — they belong to the card
      // that owns them.
      attachments: CardAttachment[];
    }
  | { type: "delta"; text: string }
  | { type: "done"; node: NodeRow }
  | { type: "error"; message: string; node: NodeRow | null };
