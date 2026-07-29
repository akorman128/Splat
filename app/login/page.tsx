"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(
    null,
  );

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }
    if (!data.session) {
      setConfirmationSentTo(email);
      setPending(false);
      return;
    }
    router.push("/c");
    router.refresh();
  }

  async function handleOAuth() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/c`,
      },
    });
    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  if (confirmationSentTo) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <Link href="/" className="text-2xl font-semibold tracking-tight">
            🫟 Splat
          </Link>
          <h1 className="text-lg font-medium">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">
              {confirmationSentTo}
            </span>
            . Open it to finish creating your account, then sign in.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setConfirmationSentTo(null);
              setMode("signin");
              setPassword("");
            }}
          >
            Back to sign in
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Link href="/" className="text-2xl font-semibold tracking-tight">
            🫟 Splat
          </Link>
          <p className="text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your canvas"
              : "Create your account"}
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleOAuth}
            disabled={pending}
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path
                fill="currentColor"
                d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
              />
            </svg>
            Continue with GitHub
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-foreground"
                onClick={() => setMode("signup")}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-foreground"
                onClick={() => setMode("signin")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
