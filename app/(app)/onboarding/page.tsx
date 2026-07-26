import { createClient } from "@/lib/supabase/server";
import { ProviderKeyForm } from "@/components/settings/ProviderKeyForm";
import { OnboardingActions } from "./OnboardingActions";
import { PROVIDERS } from "@/lib/providers/models";

// One-time onboarding step after sign-in: connect an OpenAI and/or Anthropic
// key. Skippable — the composer renders a disabled state until a key exists.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: creds } = await supabase
    .from("provider_creds")
    .select("provider, key_last4");

  const byProvider = new Map(
    (creds ?? []).map((c) => [c.provider, c.key_last4]),
  );

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Connect a model provider
          </h1>
          <p className="text-sm text-muted-foreground">
            Splat is bring-your-own-key: your prompts run against your own
            OpenAI or Anthropic account. Add at least one key to start.
          </p>
        </div>
        {PROVIDERS.map((p) => (
          <ProviderKeyForm
            key={p}
            provider={p}
            connectedLast4={byProvider.get(p) ?? null}
          />
        ))}
        <OnboardingActions hasAnyKey={byProvider.size > 0} />
      </div>
    </div>
  );
}
