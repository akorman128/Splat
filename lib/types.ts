import type { Database } from "@/lib/supabase/types";
import type { Provider } from "@/lib/providers/models";

export type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
export type ContextEdgeRow =
  Database["public"]["Tables"]["context_edges"]["Row"];
export type SuggestionRow = Database["public"]["Tables"]["suggestions"]["Row"];
export type ConversationRow =
  Database["public"]["Tables"]["conversations"]["Row"];

// Matches the column default. A conversation still carrying it has never been
// titled — by the user or by the root card's auto-title.
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

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
