import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { ProviderKeyList } from "@/components/settings/ProviderKeyList";
import { GranolaConnection } from "@/components/meetings/GranolaConnection";
import { WebSearchSetting } from "@/components/settings/WebSearchSetting";
import { HighlightColorSetting } from "@/components/settings/HighlightColorSetting";
import { asHighlightColor } from "@/lib/highlights/palette";

export default async function SettingsPage(props: PageProps<"/settings">) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const [{ data: profile }, { data: granola }, { granola_error }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("web_search, highlight_color")
        .maybeSingle(),
      supabase.from("granola_connections").select("email").maybeSingle(),
      props.searchParams,
    ]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the provider API keys your prompts run against, the Granola
        account meetings are imported from, and how new prompts behave.
      </p>
      <ProviderKeyList />
      <GranolaConnection
        connected={granola !== null}
        email={granola?.email ?? null}
        error={typeof granola_error === "string" ? granola_error : null}
        returnTo="/settings"
      />
      <WebSearchSetting userId={user.id} initialOn={profile?.web_search ?? true} />
      <HighlightColorSetting
        userId={user.id}
        initialColor={asHighlightColor(profile?.highlight_color)}
      />
    </div>
  );
}
