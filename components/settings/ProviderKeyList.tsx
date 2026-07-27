import { createClient } from "@/lib/supabase/server";
import { ProviderKeyForm } from "./ProviderKeyForm";
import { PROVIDERS } from "@/lib/providers/models";

export async function ProviderKeyList() {
  const supabase = await createClient();
  const { data: creds } = await supabase
    .from("provider_creds")
    .select("provider, key_last4");

  const byProvider = new Map((creds ?? []).map((c) => [c.provider, c.key_last4]));

  return (
    <>
      {PROVIDERS.map((p) => (
        <ProviderKeyForm
          key={p}
          provider={p}
          connectedLast4={byProvider.get(p) ?? null}
        />
      ))}
    </>
  );
}

export async function hasAnyProviderKey(): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("provider_creds")
    .select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}
