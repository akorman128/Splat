"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROVIDER_KEY_URLS,
  PROVIDER_LABELS,
  type Provider,
} from "@/lib/providers/models";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export function ProviderKeyForm({
  provider,
  connectedLast4,
}: {
  provider: Provider;
  connectedLast4: string | null;
}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A route handler can answer with something that isn't JSON — a platform
  // 502/504 HTML page, or the 500 thrown when APP_ENCRYPTION_KEY is missing.
  // An unguarded res.json() rejects there, and since setBusy(false) sat after
  // the await the form was left spinning forever with no message.
  async function readBody(res: Response): Promise<{ error?: string }> {
    return (await res.json().catch(() => ({}))) as { error?: string };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const data = await readBody(res);
      if (!res.ok) {
        setError(data.error ?? `Something went wrong (${res.status})`);
        return;
      }
      setKey("");
      toast.success(`${PROVIDER_LABELS[provider]} key verified and saved`);
      router.refresh();
    } catch {
      setError("Network error — the request never reached the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/credentials?provider=${provider}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await readBody(res);
        toast.error(data.error ?? `Could not remove key (${res.status})`);
        return;
      }
      toast.success(`${PROVIDER_LABELS[provider]} key removed`);
      router.refresh();
    } catch {
      toast.error("Network error — the request never reached the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`key-${provider}`} className="text-base">
            {PROVIDER_LABELS[provider]}
          </Label>
          <a
            href={PROVIDER_KEY_URLS[provider]}
            target="_blank"
            rel="noopener noreferrer"
            title={`Get an API key from ${PROVIDER_LABELS[provider]}`}
            aria-label={`Get an API key from ${PROVIDER_LABELS[provider]} (opens in a new tab)`}
            className="rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        {connectedLast4 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-green-600" />
            Connected · ····{connectedLast4}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={`key-${provider}`}
          type="password"
          placeholder={
            connectedLast4 ? "Paste a new key to replace" : "Paste your API key"
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
        <Button type="submit" disabled={busy || key.trim().length === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
        {connectedLast4 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={remove}
          >
            Remove
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Verified against the provider, encrypted at rest, and only ever
        decrypted inside server route handlers.
      </p>
    </form>
  );
}
