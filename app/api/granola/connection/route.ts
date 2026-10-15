import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { signOutOfGranola } from "@/lib/meetings/granola";
import { granolaConnection } from "@/lib/meetings/keys";

export async function DELETE() {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const connection = await granolaConnection(supabase, user.id);
  if (connection.ok) {
    await signOutOfGranola(connection.session).catch((err) =>
      console.warn(
        `[granola] sign_out failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  const { error } = await supabase
    .from("granola_connections")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
