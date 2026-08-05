import { ProviderKeyList } from "@/components/settings/ProviderKeyList";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the provider API keys your prompts run against.
      </p>
      <ProviderKeyList />
    </div>
  );
}
