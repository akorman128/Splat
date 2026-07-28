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

// Matches the column default. A conversation still carrying it has never been
// titled — by the user or by the root card's auto-title.
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

// Same idea for a freshly created skill, which is named before it is written.
export const MAX_SKILL_NAME_LENGTH = 60;

// What a card needs to render. The public share view is served a node without
// its owner's user_id, so nothing on the canvas may depend on that column.
export type CardNode = Omit<NodeRow, "user_id">;

// The payload of the shared_conversation() RPC — one shared canvas, read-only.
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
};

// What the composer needs to offer a skill in its "/" menu and show it as an
// attached chip. The instructions themselves never reach the client — they are
// read server-side when the prompt is assembled.
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
  | { type: "node"; node: NodeRow; edges: ContextEdgeRow[] }
  | { type: "delta"; text: string }
  | { type: "done"; node: NodeRow }
  | { type: "error"; message: string; node: NodeRow | null };
