import { headers } from "next/headers";
import { ShortcutList } from "@/components/shortcut-list";
import { SHORTCUTS_HINT, modifierLabelFor } from "@/lib/shortcuts";

export default async function ShortcutsPage() {
  // Resolved server-side so the rendered modifier key matches on hydration.
  const headerList = await headers();
  const platform =
    headerList.get("sec-ch-ua-platform") ?? headerList.get("user-agent") ?? "";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{SHORTCUTS_HINT}</p>
      <ShortcutList modifier={modifierLabelFor(platform)} />
    </div>
  );
}
