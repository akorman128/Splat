import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { ProviderKeyList } from "@/components/settings/ProviderKeyList";
import { WebSearchSetting } from "@/components/settings/WebSearchSetting";
import { HighlightColorSetting } from "@/components/settings/HighlightColorSetting";
import { asHighlightColor } from "@/lib/highlights/palette";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("web_search, highlight_color")
    .maybeSingle();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the provider API keys your prompts run against, and how new
        prompts behave.
      </p>
      <ProviderKeyList />
      <WebSearchSetting userId={user.id} initialOn={profile?.web_search ?? true} />
      <HighlightColorSetting
        userId={user.id}
        initialColor={asHighlightColor(profile?.highlight_color)}
      />
    </div>
  );
}
