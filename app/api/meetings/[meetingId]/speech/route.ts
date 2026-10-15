import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { openrouterKey } from "@/lib/meetings/keys";
import {
  MEETING_AUDIO_BUCKET,
  meetingAudioPath,
  synthesize,
  voiceFor,
} from "@/lib/meetings/speech";
import {
  asTranscript,
  speakersInOrder,
  toSections,
} from "@/lib/meetings/transcript";

// A meeting's transcript is never rewritten after import, so the audio for an
// index is the audio for that passage for as long as the meeting lives.
const AUDIO_HEADERS = {
  "Content-Type": "audio/mpeg",
  "Cache-Control": "private, max-age=604800, immutable",
};

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/meetings/[meetingId]/speech">,
) {
  const { meetingId } = await ctx.params;
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const index = Number(new URL(request.url).searchParams.get("section"));
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("transcript")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const sections = toSections(asTranscript(meeting.transcript));
  const section = sections[index];
  if (!section) {
    return NextResponse.json({ error: "Unknown section" }, { status: 404 });
  }

  const path = meetingAudioPath(user.id, meetingId, index);
  const bucket = supabase.storage.from(MEETING_AUDIO_BUCKET);
  const { data: stored } = await bucket.download(path);
  if (stored && stored.size > 0) {
    return new Response(stored, { headers: AUDIO_HEADERS });
  }

  const key = await openrouterKey(supabase);
  if (!key.ok) {
    return NextResponse.json({ error: key.error }, { status: key.status });
  }

  let audio: ReadableStream<Uint8Array>;
  try {
    audio = await synthesize({
      apiKey: key.apiKey,
      text: section.text,
      voice: voiceFor(section.speaker, speakersInOrder(sections)),
      signal: request.signal,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Speech request failed" },
      { status: 502 },
    );
  }

  // Kept only once the whole clip has arrived: a listener skipping ahead
  // aborts the provider request, and half a clip must not be served as the
  // passage forever after.
  const [toListener, toStorage] = audio.tee();
  const saving = new Response(toStorage)
    .arrayBuffer()
    .then(async (bytes) => {
      if (bytes.byteLength === 0) return;
      const { error } = await bucket.upload(path, bytes, {
        contentType: "audio/mpeg",
        upsert: false,
      });
      if (error && !/exists|duplicate/i.test(error.message)) {
        console.warn(
          `[meetings/speech] could not keep ${path}: ${error.message}`,
        );
      }
    })
    .catch(() => {});
  after(() => saving);

  return new Response(toListener, { headers: AUDIO_HEADERS });
}
