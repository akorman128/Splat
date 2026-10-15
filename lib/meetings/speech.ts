import "server-only";
import { attributionHeaders } from "@/lib/providers/openrouter";

// https://openrouter.ai/docs/guides/overview/multimodal/tts
const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

// Priced per input character, and a meeting runs to tens of thousands of them:
// at $0.62 per million an hour of transcript costs a few cents to hear, where
// the ElevenLabs and Gemini voices cost around a dollar.
export const SPEECH_MODEL = "hexgrad/kokoro-82m";

// Alternating American and British, female and male, so the speakers who
// talk most are the easiest to tell apart.
const VOICES = [
  "af_heart",
  "am_michael",
  "bf_emma",
  "bm_george",
  "af_bella",
  "am_fenrir",
  "bf_isabella",
  "bm_fable",
  "af_nicole",
  "am_puck",
];

export const MEETING_AUDIO_BUCKET = "meeting-audio";

export function meetingAudioPath(
  userId: string,
  meetingId: string,
  index: number,
): string {
  return `${userId}/${meetingId}/${index}.mp3`;
}

export function voiceFor(speaker: string, speakers: string[]): string {
  const position = Math.max(0, speakers.indexOf(speaker));
  return VOICES[position % VOICES.length];
}

export async function synthesize(opts: {
  apiKey: string;
  text: string;
  voice: string;
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      ...attributionHeaders(),
    },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      input: opts.text,
      voice: opts.voice,
      response_format: "mp3",
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      res.status === 401 || res.status === 403
        ? "OpenRouter rejected the stored API key. Replace it in Settings."
        : `OpenRouter could not read this aloud (HTTP ${res.status})${
            body.error?.message ? `: ${body.error.message}` : ""
          }`,
    );
  }
  return res.body;
}
