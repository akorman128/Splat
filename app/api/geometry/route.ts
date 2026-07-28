import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";

type GeometryUpdate = { id: string; x: number; y: number; w: number; h: number };

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
  if (!(await currentUser())) {
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
