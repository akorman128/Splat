import { headers } from "next/headers";
import { ProviderKeyList } from "@/components/settings/ProviderKeyList";
import { ShortcutList } from "@/components/shortcut-list";
import { SHORTCUTS_HINT, modifierLabelFor } from "@/lib/shortcuts";

export default async function SettingsPage() {
  // Resolved server-side so the rendered modifier key matches on hydration.
  const headerList = await headers();
  const platform =
    headerList.get("sec-ch-ua-platform") ?? headerList.get("user-agent") ?? "";

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your provider API keys and keyboard shortcuts.
          </p>
        </div>
        <ProviderKeyList />
        <section className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1">
            <h2 className="text-base font-medium">Keyboard shortcuts</h2>
            <p className="text-xs text-muted-foreground">{SHORTCUTS_HINT}</p>
          </div>
          <ShortcutList modifier={modifierLabelFor(platform)} />
        </section>
      </div>
    </div>
  );
}
