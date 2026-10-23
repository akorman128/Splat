import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MeetingPlayer } from "@/components/meetings/MeetingPlayer";
import { asTranscript, toSections } from "@/lib/meetings/transcript";
import { noSpeechKeyReason } from "@/lib/meetings/keys";

export default async function MeetingPage(
  props: PageProps<"/meetings/[meetingId]">,
) {
  const { meetingId } = await props.params;
  const supabase = await createClient();

  const [{ data: meeting }, { data: creds }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, title, met_at, transcript")
      .eq("id", meetingId)
      .maybeSingle(),
    supabase
      .from("provider_creds")
      .select("provider")
      .in("provider", ["openrouter", "anthropic"]),
  ]);
  if (!meeting) notFound();
  const providers = (creds ?? []).map((row) => row.provider);

  return (
    <MeetingPlayer
      key={meeting.id}
      meeting={{ id: meeting.id, title: meeting.title, met_at: meeting.met_at }}
      sections={toSections(asTranscript(meeting.transcript))}
      noKeyReason={
        providers.includes("openrouter")
          ? null
          : noSpeechKeyReason(providers.includes("anthropic"))
      }
    />
  );
}
