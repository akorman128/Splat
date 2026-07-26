import {
  ProviderKeyList,
  hasAnyProviderKey,
} from "@/components/settings/ProviderKeyList";
import { OnboardingActions } from "./OnboardingActions";

// One-time onboarding step after sign-in: connect an OpenAI and/or Anthropic
// key. Skippable — the composer renders a disabled state until a key exists.
export default async function OnboardingPage() {
  const hasKey = await hasAnyProviderKey();

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
        <ProviderKeyList />
        <OnboardingActions hasAnyKey={hasKey} />
      </div>
    </div>
  );
}
