import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ConversationShell } from "@/components/canvas/ConversationShell";
import type { CredentialSummary, SkillSummary } from "@/lib/types";
import type { Provider } from "@/lib/providers/models";

// None of these depends on which conversation is open, so they are read once
// here rather than again on every hop between conversations.
export default async function ConversationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const [{ data: credentials }, { data: skills }, { data: profile }] =
    await Promise.all([
      supabase.from("provider_creds").select("provider, key_last4"),
      supabase.from("skills").select("id, name").order("name"),
      supabase.from("profiles").select("web_search").maybeSingle(),
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
      webSearchDefault={profile?.web_search ?? true}
    >
      <Suspense fallback={null}>{children}</Suspense>
    </ConversationShell>
  );
}
