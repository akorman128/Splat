import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments/types";

// Signed URLs are minted here rather than in the browser so that storage_path
// never has to ride along in the canvas payload. RLS on `attachments` is what
// decides whose files these are; this route only turns ids into links.
export const SIGNED_URL_TTL_SECONDS = 3600;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string"))]
    : null;
  if (!ids) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (ids.length === 0) return NextResponse.json({ urls: {} });

  const { data: rows, error } = await supabase
    .from("attachments")
    .select("id, storage_path")
    .in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) return NextResponse.json({ urls: {} });

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );
  if (signError) {
    return NextResponse.json({ error: signError.message }, { status: 500 });
  }

  const byPath = new Map(
    (signed ?? [])
      .filter((s) => s.signedUrl && !s.error)
      .map((s) => [s.path ?? "", s.signedUrl]),
  );
  const urls: Record<string, string> = {};
  for (const row of rows) {
    const url = byPath.get(row.storage_path);
    if (url) urls[row.id] = url;
  }

  return NextResponse.json({ urls });
}
