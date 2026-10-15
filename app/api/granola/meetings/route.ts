import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { listGranolaMeetings } from "@/lib/meetings/granola";
import { granolaConnection, granolaFailure } from "@/lib/meetings/keys";

export async function GET() {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const connection = await granolaConnection(supabase, user.id);
  if (!connection.ok) {
    return NextResponse.json(
      { error: connection.error },
      { status: connection.status },
    );
  }

  try {
    return NextResponse.json({
      meetings: await listGranolaMeetings(connection.session, connection.save),
    });
  } catch (err) {
    return granolaFailure(err, connection);
  }
}
