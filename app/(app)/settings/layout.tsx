import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <SettingsNav />
        {children}
      </div>
    </div>
  );
}
