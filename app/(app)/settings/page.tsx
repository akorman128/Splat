import { ProviderKeyList } from "@/components/settings/ProviderKeyList";

export default async function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your provider API keys.
          </p>
        </div>
        <ProviderKeyList />
      </div>
    </div>
  );
}
