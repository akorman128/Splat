"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function OnboardingActions({ hasAnyKey }: { hasAnyKey: boolean }) {
  const router = useRouter();

  function proceed() {
    // Remember the skip so /c stops bouncing back here; keys can always be
    // added later under Settings.
    document.cookie = "onboarding-skipped=1; path=/; max-age=31536000";
    router.push("/c");
  }

  return (
    <div className="flex justify-center">
      <Button
        variant={hasAnyKey ? "default" : "ghost"}
        onClick={proceed}
      >
        {hasAnyKey ? "Continue to canvas" : "Skip for now"}
      </Button>
    </div>
  );
}
