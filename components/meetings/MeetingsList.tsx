"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch, postJson } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import { MeetingDate } from "./MeetingDate";
import { Headphones, Loader2, Search } from "lucide-react";

const RECENT = 10;
const MAX_MATCHES = 50;

export type ImportedMeeting = {
  id: string;
  title: string;
  met_at: string;
  granola_meeting_id: string;
};

type GranolaMeeting = {
  id: string;
  title: string;
  meeting_at: string;
  participants: string[];
  people: string;
};

type Row = {
  key: string;
  title: string;
  at: string;
  participants: string[];
  haystack: string;
  meetingId: string | null;
  granolaId: string | null;
};

// Imported meetings are listed even when Granola no longer is — disconnected,
// or the note deleted there — since the transcript lives in Splat by then.
function toRows(granola: GranolaMeeting[], imported: ImportedMeeting[]): Row[] {
  const importedByGranola = new Map(
    imported.map((m) => [m.granola_meeting_id, m.id]),
  );
  const rows: Row[] = granola.map((m) => ({
    key: m.id,
    title: m.title,
    at: m.meeting_at,
    participants: m.participants,
    haystack: `${m.title} ${m.people}`.toLowerCase(),
    meetingId: importedByGranola.get(m.id) ?? null,
    granolaId: m.id,
  }));
  const listed = new Set(granola.map((m) => m.id));
  for (const m of imported) {
    if (listed.has(m.granola_meeting_id)) continue;
    rows.push({
      key: m.id,
      title: m.title,
      at: m.met_at,
      participants: [],
      haystack: m.title.toLowerCase(),
      meetingId: m.id,
      granolaId: null,
    });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function MeetingsList({
  imported,
  connected,
}: {
  imported: ImportedMeeting[];
  connected: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const granola = useQuery({
    queryKey: queryKeys.granolaMeetings(),
    queryFn: () =>
      apiFetch<{ meetings: GranolaMeeting[] }>("/api/granola/meetings"),
    enabled: connected,
  });

  const signedOut =
    granola.error instanceof ApiError && granola.error.status === 401;
  useEffect(() => {
    if (signedOut) router.refresh();
  }, [router, signedOut]);

  const importMeeting = useMutation({
    mutationFn: (granolaMeetingId: string) =>
      apiFetch<{ id: string }>("/api/meetings", postJson({ granolaMeetingId })),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.granolaMeetings() });
      router.push(`/meetings/${id}`);
      router.refresh();
    },
    onError: (error) =>
      toast.error("Could not import the transcript", {
        description: error.message,
      }),
  });

  const rows = useMemo(
    () => toRows(granola.data?.meetings ?? [], imported),
    [granola.data, imported],
  );

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? rows.filter((row) => terms.every((term) => row.haystack.includes(term)))
    : rows;
  const shown = matches.slice(0, terms.length ? MAX_MATCHES : RECENT);

  let summary: string;
  if (terms.length) {
    summary =
      matches.length === 0
        ? "No meetings match."
        : matches.length > shown.length
          ? `Showing the ${shown.length} most recent of ${matches.length} matches.`
          : `${matches.length} ${matches.length === 1 ? "match" : "matches"}.`;
  } else {
    summary =
      rows.length > RECENT
        ? `Your ${RECENT} most recent meetings. Search by title or attendee to find the other ${rows.length - RECENT}.`
        : "Your meetings.";
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search meetings by title, person, or company"
          aria-label="Search meetings"
          className="pl-8"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{summary}</span>
        {connected && granola.isPending && (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            Loading from Granola…
          </span>
        )}
      </div>
      {granola.isError && !signedOut && (
        <p className="text-sm text-destructive">{granola.error.message}</p>
      )}

      {shown.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {shown.map((row) => {
            const importing =
              importMeeting.isPending &&
              importMeeting.variables === row.granolaId;
            return (
              <li key={row.key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <MeetingDate iso={row.at} />
                    {row.participants.length > 0 &&
                      ` · ${row.participants.join(", ")}`}
                  </p>
                </div>
                {row.meetingId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/meetings/${row.meetingId}`} />}
                  >
                    <Headphones />
                    Listen
                  </Button>
                ) : row.granolaId ? (
                  <Button
                    size="sm"
                    disabled={importMeeting.isPending}
                    onClick={() => importMeeting.mutate(row.granolaId!)}
                  >
                    {importing ? <Loader2 className="animate-spin" /> : null}
                    Import
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
