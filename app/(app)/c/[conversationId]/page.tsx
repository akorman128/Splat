import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConversationView } from "@/components/canvas/ConversationView";
import { CARD_ATTACHMENT_COLUMNS } from "@/lib/attachments/types";
import type {
  CardAttachment,
  CredentialSummary,
  SkillSummary,
} from "@/lib/types";
import type { Provider } from "@/lib/providers/models";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) notFound();

  const [{ data: nodes }, { data: credentials }, { data: skills }] =
    await Promise.all([
      supabase
        .from("nodes")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at"),
      supabase.from("provider_creds").select("provider, key_last4"),
      supabase.from("skills").select("id, name").order("name"),
    ]);

  const nodeIds = (nodes ?? []).map((n) => n.id);
  const [{ data: edges }, { data: suggestions }, { data: attachments }] =
    nodeIds.length
      ? await Promise.all([
          supabase.from("context_edges").select("*").in("node_id", nodeIds),
          supabase.from("suggestions").select("*").in("node_id", nodeIds),
          supabase
            .from("attachments")
            .select(CARD_ATTACHMENT_COLUMNS)
            .in("node_id", nodeIds)
            .order("created_at"),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <ConversationView
      conversationId={conversationId}
      nodes={nodes ?? []}
      edges={edges ?? []}
      suggestions={suggestions ?? []}
      attachments={(attachments ?? []) as CardAttachment[]}
      credentials={(credentials ?? []).map((c) => ({
        provider: c.provider as Provider,
        key_last4: c.key_last4,
      })) satisfies CredentialSummary[]}
      skills={(skills ?? []) satisfies SkillSummary[]}
    />
  );
}
