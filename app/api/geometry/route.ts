import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Card geometry is normally persisted straight from the browser's Supabase
// client, debounced (see components/canvas/Canvas.tsx). That path cannot work
// while the page is being torn down: an ordinary fetch is cancelled the moment
// the document unloads, so a drag followed immediately by a reload lost the
// new position. `navigator.sendBeacon` is the transport that survives unload,
// and it needs a same-origin URL to post to — this one. RLS still applies:
// nodes_all_own restricts the update to the caller's own rows.

type GeometryUpdate = { id: string; x: number; y: number; w: number; h: number };

// A canvas that has been dragged around a lot still only has as many pending
// entries as it has cards; anything past this is not a real client.
const MAX_UPDATES = 200;

function isGeometryUpdate(value: unknown): value is GeometryUpdate {
  if (typeof value !== "object" || value === null) return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    u.id.length > 0 &&
    ["x", "y", "w", "h"].every(
      (k) => typeof u[k] === "number" && Number.isFinite(u[k]),
    )
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { updates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { updates } = body;
  if (!Array.isArray(updates) || !updates.every(isGeometryUpdate)) {
    return NextResponse.json(
      { error: "Expected { updates: [{ id, x, y, w, h }] }" },
      { status: 400 },
    );
  }
  if (updates.length > MAX_UPDATES) {
    return NextResponse.json(
      { error: `Too many updates (max ${MAX_UPDATES})` },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from("nodes")
        .update({
          canvas_x: u.x,
          canvas_y: u.y,
          canvas_w: u.w,
          canvas_h: u.h,
        })
        .eq("id", u.id),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: updates.length });
}
