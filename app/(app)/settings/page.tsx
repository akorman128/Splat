import { createClient } from "@/lib/supabase/server";
import { ProviderKeyForm } from "@/components/settings/ProviderKeyForm";
import { PROVIDERS } from "@/lib/providers/models";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: creds } = await supabase
    .from("provider_creds")
    .select("provider, key_last4");

  const byProvider = new Map(
    (creds ?? []).map((c) => [c.provider, c.key_last4]),
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your provider API keys.
          </p>
        </div>
        {PROVIDERS.map((p) => (
          <ProviderKeyForm
            key={p}
            provider={p}
            connectedLast4={byProvider.get(p) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
