import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ConversationShell } from "@/components/canvas/ConversationShell";
import type { CredentialSummary, SkillSummary } from "@/lib/types";
import type { Provider } from "@/lib/providers/models";

// Holds the canvas still while the page below it changes. Neither of these
// depends on which conversation is open, so they are read once here rather than
// again on every hop between conversations.
export default async function ConversationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const [{ data: credentials }, { data: skills }] = await Promise.all([
    supabase.from("provider_creds").select("provider, key_last4"),
    supabase.from("skills").select("id, name").order("name"),
  ]);

  return (
    <ConversationShell
      credentials={
        (credentials ?? []).map((c) => ({
          provider: c.provider as Provider,
          key_last4: c.key_last4,
        })) satisfies CredentialSummary[]
      }
      skills={(skills ?? []) satisfies SkillSummary[]}
    >
      {/* Lets a cold load paint the shell instead of waiting on the page's queries. */}
      <Suspense fallback={null}>{children}</Suspense>
    </ConversationShell>
  );
}
