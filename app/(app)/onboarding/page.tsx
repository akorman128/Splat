import {
  ProviderKeyList,
  hasAnyProviderKey,
} from "@/components/settings/ProviderKeyList";
import { OnboardingActions } from "./OnboardingActions";

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
            OpenAI, Anthropic, or OpenRouter account. Add at least one key to
            start — OpenRouter opens up any model it serves.
          </p>
        </div>
        <ProviderKeyList />
        <OnboardingActions hasAnyKey={hasKey} />
      </div>
    </div>
  );
}
