"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/query/api";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export function GranolaConnection({
  connected,
  email,
  error,
  returnTo,
}: {
  connected: boolean;
  email: string | null;
  error: string | null;
  returnTo: string;
}) {
  const router = useRouter();
  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/granola/connection", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Granola disconnected");
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-base">Granola</Label>
          <a
            href="https://docs.granola.ai/help-center/sharing/integrations/mcp"
            target="_blank"
            rel="noopener noreferrer"
            title="How Splat connects to Granola"
            aria-label="How Splat connects to Granola (opens in a new tab)"
            className="rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        {connected && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
            <span className="truncate">
              Connected{email ? ` · ${email}` : ""}
            </span>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {connected ? (
          <Button
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            {disconnect.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Disconnect"
            )}
          </Button>
        ) : (
          <Button
            nativeButton={false}
            render={
              <a
                href={`/api/granola/connect?returnTo=${encodeURIComponent(returnTo)}`}
              />
            }
          >
            Sign in with Granola
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Imports meeting transcripts to listen back to. Transcripts need a paid
        Granola plan. The sign-in is encrypted at rest and only ever used inside
        server route handlers.
      </p>
    </div>
  );
}
