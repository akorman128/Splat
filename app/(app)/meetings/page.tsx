import { createClient } from "@/lib/supabase/server";
import { GranolaConnection } from "@/components/meetings/GranolaConnection";
import { MeetingsList } from "@/components/meetings/MeetingsList";

export default async function MeetingsPage(props: PageProps<"/meetings">) {
  const supabase = await createClient();
  const [{ data: imported }, { data: granola }, { granola_error }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("id, title, met_at, granola_meeting_id")
        .order("met_at", { ascending: false }),
      supabase.from("granola_connections").select("email").maybeSingle(),
      props.searchParams,
    ]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground">
            Import a transcript from Granola and listen back to it, read aloud
            through your OpenRouter key.
          </p>
        </div>

        {!granola && (
          <GranolaConnection
            connected={false}
            email={null}
            error={typeof granola_error === "string" ? granola_error : null}
            returnTo="/meetings"
          />
        )}

        <MeetingsList imported={imported ?? []} connected={granola !== null} />
      </div>
    </div>
  );
}
