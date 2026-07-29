import { createClient } from "@/lib/supabase/server";
import { ConversationView } from "@/components/canvas/ConversationView";
import type { CredentialSummary, SkillSummary } from "@/lib/types";
import type { Provider } from "@/lib/providers/models";

// An empty canvas with nothing behind it. The conversation is written when the
// first prompt is sent, so a draft the user walks away from costs nothing.
export default async function NewConversationPage() {
  const supabase = await createClient();

  const [{ data: credentials }, { data: skills }] = await Promise.all([
    supabase.from("provider_creds").select("provider, key_last4"),
    supabase.from("skills").select("id, name").order("name"),
  ]);

  return (
    <ConversationView
      conversationId={null}
      nodes={[]}
      edges={[]}
      suggestions={[]}
      credentials={(credentials ?? []).map((c) => ({
        provider: c.provider as Provider,
        key_last4: c.key_last4,
      })) satisfies CredentialSummary[]}
      skills={(skills ?? []) satisfies SkillSummary[]}
    />
  );
}
