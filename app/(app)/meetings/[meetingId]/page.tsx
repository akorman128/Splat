import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MeetingPlayer } from "@/components/meetings/MeetingPlayer";
import { asTranscript, toSections } from "@/lib/meetings/transcript";

export default async function MeetingPage(
  props: PageProps<"/meetings/[meetingId]">,
) {
  const { meetingId } = await props.params;
  const supabase = await createClient();

  const [{ data: meeting }, { count: openrouterKeys }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, title, met_at, transcript")
      .eq("id", meetingId)
      .maybeSingle(),
    supabase
      .from("provider_creds")
      .select("id", { count: "exact", head: true })
      .eq("provider", "openrouter"),
  ]);
  if (!meeting) notFound();

  return (
    <MeetingPlayer
      key={meeting.id}
      meeting={{ id: meeting.id, title: meeting.title, met_at: meeting.met_at }}
      sections={toSections(asTranscript(meeting.transcript))}
      canPlay={(openrouterKeys ?? 0) > 0}
    />
  );
}
