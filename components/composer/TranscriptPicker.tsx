"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MeetingDate } from "@/components/meetings/MeetingDate";
import type { GranolaMeeting } from "@/components/meetings/MeetingsList";
import { ApiError, apiFetch } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import { useAttachmentStore } from "@/lib/store/attachment-store";

const MAX_SHOWN = 50;

export function TranscriptPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.granolaMeetings(),
    queryFn: () =>
      apiFetch<{ meetings: GranolaMeeting[] }>("/api/granola/meetings"),
    enabled: open,
  });

  // 422 is never connected, 401 is a grant Granola has since revoked.
  const signedOut =
    error instanceof ApiError && (error.status === 422 || error.status === 401);

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const meetings = data?.meetings ?? [];
    if (terms.length === 0) return meetings;
    return meetings.filter((m) => {
      const haystack = `${m.title} ${m.people}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [data, query]);

  function attach(meeting: GranolaMeeting) {
    useAttachmentStore
      .getState()
      .transcript({ granolaMeetingId: meeting.id, title: meeting.title });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach a Granola transcript</DialogTitle>
        </DialogHeader>

        {signedOut ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Sign in to Granola to attach a meeting&apos;s transcript.
            </p>
            <Button
              nativeButton={false}
              render={
                <a
                  href={`/api/granola/connect?returnTo=${encodeURIComponent(pathname)}`}
                />
              }
            >
              Sign in with Granola
            </Button>
          </div>
        ) : (
          <>
            <Input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, person, or company"
              autoComplete="off"
            />

            <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
              {isPending ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="py-8 text-center text-sm text-destructive">
                  {error.message}
                </p>
              ) : matches.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {data && data.meetings.length > 0
                    ? "No meeting matches that."
                    : "No meetings in Granola yet."}
                </p>
              ) : (
                matches.slice(0, MAX_SHOWN).map((meeting) => (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => attach(meeting)}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
                  >
                    <span className="block truncate">{meeting.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <MeetingDate iso={meeting.meeting_at} />
                      {meeting.participants.length > 0 &&
                        ` · ${meeting.participants.join(", ")}`}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
