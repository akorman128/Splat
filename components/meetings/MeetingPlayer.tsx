"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/query/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MeetingDate } from "./MeetingDate";
import { SPEEDS, useSectionPlayer } from "./useSectionPlayer";
import type { Section } from "@/lib/meetings/transcript";
import {
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";

const SPEAKER_COLORS = [
  "text-sky-700 dark:text-sky-400",
  "text-amber-700 dark:text-amber-400",
  "text-emerald-700 dark:text-emerald-400",
  "text-rose-700 dark:text-rose-400",
  "text-violet-700 dark:text-violet-400",
  "text-orange-700 dark:text-orange-400",
];

function ownsKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="dialog"]') !== null)
  );
}

export function MeetingPlayer({
  meeting,
  sections,
  noKeyReason,
}: {
  meeting: { id: string; title: string; met_at: string };
  sections: Section[];
  noKeyReason: string | null;
}) {
  const router = useRouter();
  const canPlay = noKeyReason === null;
  const lengths = useMemo(() => sections.map((s) => s.text.length), [sections]);
  const {
    current,
    status,
    progress,
    play,
    pause,
    resume,
    toggle,
    next,
    previous,
    speed,
    setSpeed,
    changeSpeed,
    audioProps,
  } = useSectionPlayer(meeting.id, lengths, canPlay);
  const sectionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const speakers = [...new Set(sections.map((s) => s.speaker))];
  const active = status !== "idle";
  const playing = status === "playing" || status === "loading";

  useEffect(() => {
    if (playing) {
      sectionRefs.current[current]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [current, playing]);

  useEffect(() => {
    if (!canPlay) return;
    function handle(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeys(event.target)) return;
      if (event.key === " ") {
        // Space on a passage or a control would otherwise click it, and
        // clicking a passage restarts it rather than pausing.
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("button, a") &&
          !event.target.closest("[data-player]")
        ) {
          return;
        }
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === ">" || event.key === "<") {
        event.preventDefault();
        changeSpeed(event.key === ">" ? 1 : -1);
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canPlay, changeSpeed, next, previous, toggle]);

  // Headphone buttons and the lock screen drive the same three controls.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !canPlay) return;
    const session = navigator.mediaSession;
    session.setActionHandler("play", resume);
    session.setActionHandler("pause", pause);
    session.setActionHandler("previoustrack", previous);
    session.setActionHandler("nexttrack", next);
    return () => {
      for (const action of [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
      ] as const) {
        session.setActionHandler(action, null);
      }
    };
  }, [canPlay, next, pause, previous, resume]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !active) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meeting.title,
      artist: sections[current]?.speaker ?? "",
      album: "Splat meetings",
    });
  }, [active, current, meeting.title, sections]);

  async function deleteMeeting() {
    setDeleting(true);
    try {
      await apiFetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    } catch (error) {
      toast.error("Could not delete meeting", {
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    } finally {
      setDeleting(false);
    }
    setConfirmingDelete(false);
    router.push("/meetings");
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <audio {...audioProps} className="hidden" />
      <div className="flex-1 overflow-y-auto px-6 pt-12 pb-6">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div className="space-y-3">
            <Link
              href="/meetings"
              className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ArrowLeft className="size-3.5" />
              Meetings
            </Link>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {meeting.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  <MeetingDate iso={meeting.met_at} /> · {speakers.join(", ")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Delete meeting"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                <span className="sr-only">Delete meeting</span>
              </Button>
            </div>
            {!canPlay && (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                {noKeyReason} Add an OpenRouter key in{" "}
                <Link href="/settings" className="text-foreground underline">
                  Settings
                </Link>{" "}
                to listen.
              </p>
            )}
          </div>

          <ol data-player className="space-y-1">
            {sections.map((section, index) => {
              const isCurrent = active && index === current;
              return (
                <li key={index}>
                  <button
                    ref={(el) => {
                      sectionRefs.current[index] = el;
                    }}
                    type="button"
                    disabled={!canPlay}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => play(index)}
                    className={cn(
                      "relative w-full overflow-hidden rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted/60",
                      isCurrent && "bg-muted enabled:hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        SPEAKER_COLORS[
                          speakers.indexOf(section.speaker) %
                            SPEAKER_COLORS.length
                        ],
                      )}
                    >
                      {section.speaker}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed">
                      {section.text}
                    </span>
                    {isCurrent && (
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform"
                        style={{ transform: `scaleX(${progress})` }}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div data-player className="border-t bg-background px-6 py-3">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="Previous section (←)"
              disabled={!canPlay}
              onClick={previous}
            >
              <SkipBack />
              <span className="sr-only">Previous section</span>
            </Button>
            <Button
              size="icon-lg"
              className="rounded-full"
              title={playing ? "Pause (Space)" : "Play (Space)"}
              disabled={!canPlay}
              onClick={toggle}
            >
              {status === "loading" ? (
                <Loader2 className="animate-spin" />
              ) : playing ? (
                <Pause />
              ) : (
                <Play />
              )}
              <span className="sr-only">{playing ? "Pause" : "Play"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Next section (→)"
              disabled={!canPlay || current >= sections.length - 1}
              onClick={next}
            >
              <SkipForward />
              <span className="sr-only">Next section</span>
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-12 tabular-nums"
                  title="Playback speed (< and >)"
                />
              }
            >
              {speed}×<span className="sr-only">Playback speed</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuRadioGroup
                value={speed}
                onValueChange={(value) => {
                  if (typeof value === "number") setSpeed(value);
                }}
              >
                {SPEEDS.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {value}×
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {active ? (
              <>
                <span className="text-foreground">
                  {sections[current]?.speaker}
                </span>{" "}
                · section {current + 1} of {sections.length}
              </>
            ) : (
              "Press play, or pick any passage to start from there."
            )}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmingDelete(false);
        }}
        title="Delete meeting?"
        description={
          <>
            <span className="font-medium text-foreground">{meeting.title}</span>{" "}
            will be removed from Splat. It stays in Granola, and you can import
            it again.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onConfirm={deleteMeeting}
      />
    </div>
  );
}
