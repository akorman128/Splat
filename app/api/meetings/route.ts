import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import {
  MEETING_ID_PATTERN,
  getGranolaTranscript,
} from "@/lib/meetings/granola";
import { granolaConnection, granolaFailure } from "@/lib/meetings/keys";

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { granolaMeetingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const granolaMeetingId =
    typeof body.granolaMeetingId === "string" ? body.granolaMeetingId : "";
  if (!MEETING_ID_PATTERN.test(granolaMeetingId)) {
    return NextResponse.json(
      { error: "Unknown Granola meeting" },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from("meetings")
    .select("id")
    .eq("granola_meeting_id", granolaMeetingId)
    .maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id });

  const connection = await granolaConnection(supabase, user.id);
  if (!connection.ok) {
    return NextResponse.json(
      { error: connection.error },
      { status: connection.status },
    );
  }

  let meeting: Awaited<ReturnType<typeof getGranolaTranscript>>;
  try {
    meeting = await getGranolaTranscript(
      connection.session,
      connection.save,
      granolaMeetingId,
    );
  } catch (err) {
    return granolaFailure(err, connection);
  }
  if (!meeting.lines.some((line) => line.text.trim())) {
    return NextResponse.json(
      { error: "Granola has no transcript for this meeting." },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from("meetings")
    .upsert(
      {
        granola_meeting_id: granolaMeetingId,
        title: meeting.title,
        met_at: meeting.metAt,
        transcript: meeting.lines,
      },
      { onConflict: "user_id,granola_meeting_id" },
    )
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
