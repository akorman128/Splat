import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { MEETING_AUDIO_BUCKET, meetingAudioPath } from "@/lib/meetings/speech";
import { asTranscript, toSections } from "@/lib/meetings/transcript";

const REMOVE_BATCH = 500;

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/meetings/[meetingId]">,
) {
  const { meetingId } = await ctx.params;
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("transcript")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Every path a section could have been kept at, whether or not it was ever
  // played: removing one that was never written is a no-op.
  const count = toSections(asTranscript(meeting.transcript)).length;
  const paths = Array.from({ length: count }, (_, index) =>
    meetingAudioPath(user.id, meetingId, index),
  );
  for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
    const { error } = await supabase.storage
      .from(MEETING_AUDIO_BUCKET)
      .remove(paths.slice(start, start + REMOVE_BATCH));
    if (error) {
      return NextResponse.json(
        { error: `Could not remove the meeting's audio: ${error.message}` },
        { status: 500 },
      );
    }
  }

  const { error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
