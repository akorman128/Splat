import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4 max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">Splat</h1>
        <p className="text-lg text-muted-foreground text-balance">
          A graph-native AI chat client. Every prompt and response is a card on
          an infinite canvas — branch anywhere, and choose exactly which cards
          each new prompt sees as context.
        </p>
      </div>
      <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
        Sign in
      </Button>
    </main>
  );
}
