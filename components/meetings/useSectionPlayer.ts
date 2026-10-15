"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { ClipQueue, speechError } from "./clip-queue";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

const RESTART_THRESHOLD_SECONDS = 3;

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;
const SPEED_KEY = "splat:meeting-speed";

const speedListeners = new Set<() => void>();

function storedSpeed(): number {
  try {
    const value = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

function subscribeToSpeed(listener: () => void): () => void {
  speedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    speedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storeSpeed(value: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(value));
  } catch {}
  for (const listener of speedListeners) listener();
}

function speechUrlFor(meetingId: string, index: number): string {
  return `/api/meetings/${meetingId}/speech?section=${index}`;
}

export function useSectionPlayer(
  meetingId: string,
  lengths: number[],
  enabled: boolean,
) {
  const count = lengths.length;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue] = useState(
    () => new ClipQueue((index) => speechUrlFor(meetingId, index), lengths),
  );
  const unlocked = useRef(false);
  const token = useRef(0);
  const currentRef = useRef(0);
  const loaded = useRef<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [progress, setProgress] = useState(0);
  const speed = useSyncExternalStore(subscribeToSpeed, storedSpeed, () => 1);
  const speedRef = useRef(speed);

  // Loading a new source resets playbackRate to defaultPlaybackRate, so both
  // are set: one for the clip playing now, one for every clip after it.
  const applySpeed = useCallback((value: number) => {
    speedRef.current = value;
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = value;
    audio.playbackRate = value;
    audio.preservesPitch = true;
  }, []);

  useEffect(() => {
    applySpeed(speed);
    if (loaded.current !== null) {
      const at = currentRef.current;
      queue.plan(at + 1, [at - 1, at], speed);
    }
  }, [applySpeed, queue, speed]);

  const setSpeed = useCallback(
    (value: number) => {
      applySpeed(value);
      storeSpeed(value);
    },
    [applySpeed],
  );

  const changeSpeed = useCallback(
    (step: 1 | -1) => {
      const at = SPEEDS.indexOf(speedRef.current as (typeof SPEEDS)[number]);
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + step))];
      if (next !== speedRef.current) setSpeed(next);
    },
    [setSpeed],
  );

  const speechUrl = useCallback(
    (index: number) => speechUrlFor(meetingId, index),
    [meetingId],
  );

  // The opening of the meeting is fetched before anyone presses play.
  useEffect(() => {
    if (enabled) queue.plan(0, [], speedRef.current);
    return () => queue.dispose();
  }, [enabled, queue]);

  // Safari only lets a media element start from inside the gesture, and once
  // it has, later plays need none. So until the first clip has played, a
  // section that is not ready yet is streamed from the route rather than
  // awaited, which keeps audio.play() inside the click; streaming also starts
  // the sound while the rest is still being generated.
  const play = useCallback(
    async (index: number) => {
      const audio = audioRef.current;
      if (!audio || index < 0 || index >= count) return;
      const mine = ++token.current;
      currentRef.current = index;
      setCurrent(index);
      setProgress(0);
      setStatus("loading");

      const clip = queue.get(index);
      let src: string;
      if (clip?.url) {
        src = clip.url;
      } else if (clip && unlocked.current) {
        audio.pause();
        queue.plan(index + 1, [index - 1, index], speedRef.current);
        src = await clip.ready.catch(() => speechUrl(index));
        if (mine !== token.current) return;
      } else {
        queue.drop(index);
        queue.retry(index);
        src = speechUrl(index);
      }

      loaded.current = index;
      audio.src = src;
      applySpeed(speedRef.current);
      audio.play().catch((err: unknown) => {
        if (mine !== token.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("paused");
      });
      queue.plan(index + 1, [index - 1, index], speedRef.current);
    },
    [applySpeed, count, queue, speechUrl],
  );

  const pause = useCallback(() => {
    token.current++;
    audioRef.current?.pause();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (audio && loaded.current === currentRef.current && audio.src) {
      setStatus("loading");
      audio.play().catch(() => setStatus("paused"));
    } else {
      play(currentRef.current);
    }
  }, [play]);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else resume();
  }, [pause, resume, status]);

  const next = useCallback(() => {
    play(currentRef.current + 1);
  }, [play]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (
      audio &&
      loaded.current === currentRef.current &&
      audio.currentTime > RESTART_THRESHOLD_SECONDS
    ) {
      audio.currentTime = 0;
      if (audio.paused) resume();
      return;
    }
    play(Math.max(0, currentRef.current - 1));
  }, [play, resume]);

  // A failed stream reaches the element as a bare decode error, so the reason
  // is asked for again. The failures worth naming — no key, a key OpenRouter
  // refused, a section that is not there — are all answered without audio, so
  // asking twice only costs a second generation when the first one broke off.
  const onError = useCallback(async () => {
    const mine = token.current;
    const res = await fetch(speechUrl(currentRef.current)).catch(() => null);
    if (mine !== token.current) return;
    const message =
      res && !res.ok
        ? await speechError(res)
        : "Could not play this section. Try it again.";
    res?.body?.cancel().catch(() => {});
    loaded.current = null;
    setStatus("paused");
    toast.error(message);
  }, [speechUrl]);

  const audioProps = {
    ref: audioRef,
    preload: "auto" as const,
    onPlaying: () => {
      unlocked.current = true;
      setStatus("playing");
    },
    onWaiting: () => setStatus("loading"),
    onPause: () => {
      const audio = audioRef.current;
      if (audio && !audio.ended) {
        setStatus((s) => (s === "loading" ? s : "paused"));
      }
    },
    onTimeUpdate: () => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
      }
    },
    onEnded: () => {
      if (currentRef.current + 1 < count) {
        play(currentRef.current + 1);
      } else {
        setProgress(1);
        setStatus("idle");
      }
    },
    onError,
  };

  return {
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
  };
}
