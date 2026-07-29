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

// Matches the column default.
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

// Matches the column's check constraint.
export const MAX_SKILL_NAME_LENGTH = 60;

// The share view is served nodes without user_id, so nothing on the canvas may
// depend on that column.
export type CardNode = Omit<NodeRow, "user_id">;

// extracted_text is megabytes on a long PDF, and storage_path is minted into a
// signed URL server-side rather than handed to the browser.
export type CardAttachment = Omit<
  AttachmentRow,
  "user_id" | "storage_path" | "extracted_text"
>;

// The payload of the shared_conversation() RPC.
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

// Instructions are left out so they don't ride along with every page load.
export type SkillSummary = {
  id: string;
  name: string;
};

// The live row when the skill still exists, the node_skills snapshot when not.
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
      // Only the drafts this card claimed; replayed ancestor files belong to
      // the card that owns them.
      attachments: CardAttachment[];
    }
  | { type: "delta"; text: string }
  | { type: "done"; node: NodeRow }
  | { type: "error"; message: string; node: NodeRow | null };
