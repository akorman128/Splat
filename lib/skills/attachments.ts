import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { AttachedSkill } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type SkillSelection =
  | { ok: true; skills: AttachedSkill[] }
  | { ok: false; error: string };

// RLS scopes the read to the caller, so an id belonging to someone else looks
// exactly like one that doesn't exist — both are rejected here.
export async function resolveSkillIds(
  supabase: SupabaseServerClient,
  skillIds: string[],
): Promise<SkillSelection> {
  if (skillIds.length === 0) return { ok: true, skills: [] };

  const { data, error } = await supabase
    .from("skills")
    .select("id, name, instructions")
    .in("id", skillIds);
  if (error) return { ok: false, error: error.message };

  const byId = new Map((data ?? []).map((s) => [s.id, s]));
  const skills: AttachedSkill[] = [];
  for (const id of skillIds) {
    const skill = byId.get(id);
    if (!skill) return { ok: false, error: "Skill not found" };
    skills.push({
      skillId: skill.id,
      name: skill.name,
      instructions: skill.instructions,
    });
  }
  return { ok: true, skills };
}

// What a card was built with. A skill that still exists wins over the snapshot,
// so editing a skill and regenerating picks up the new text; a deleted one
// falls back to what was actually sent the first time.
export async function nodeSkills(
  supabase: SupabaseServerClient,
  nodeId: string,
): Promise<AttachedSkill[]> {
  const { data: rows } = await supabase
    .from("node_skills")
    .select("skill_id, name, instructions")
    .eq("node_id", nodeId)
    .order("position");
  if (!rows || rows.length === 0) return [];

  const liveIds = rows
    .map((r) => r.skill_id)
    .filter((id): id is string => id !== null);
  const { data: live } = liveIds.length
    ? await supabase
        .from("skills")
        .select("id, name, instructions")
        .in("id", liveIds)
    : { data: [] };
  const byId = new Map((live ?? []).map((s) => [s.id, s]));

  return rows.map((row) => {
    const current = row.skill_id ? byId.get(row.skill_id) : undefined;
    return {
      skillId: row.skill_id,
      name: current?.name ?? row.name,
      instructions: current?.instructions ?? row.instructions,
    };
  });
}

export async function replaceNodeSkills(
  supabase: SupabaseServerClient,
  nodeId: string,
  skills: AttachedSkill[],
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("node_skills")
    .delete()
    .eq("node_id", nodeId);
  if (deleteError) return deleteError.message;
  if (skills.length === 0) return null;

  const { error } = await supabase.from("node_skills").insert(
    skills.map((skill, index) => ({
      node_id: nodeId,
      skill_id: skill.skillId,
      name: skill.name,
      instructions: skill.instructions,
      position: index,
    })),
  );
  return error?.message ?? null;
}

export function skillSystemPrompt(skills: AttachedSkill[]): string | undefined {
  const parts = skills
    .filter((s) => s.instructions.trim())
    .map((s) => `## ${s.name}\n\n${s.instructions.trim()}`);
  if (parts.length === 0) return undefined;
  return `# Skills\n\nThe user attached these instructions to this request. Follow them.\n\n${parts.join("\n\n")}`;
}
