"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { MAX_SKILL_NAME_LENGTH } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

// Names are unique per owner, so that collision is the one worth wording.
function writeFailed(
  error: { code: string; message: string },
  verb: string,
): Error {
  return new Error(
    error.code === UNIQUE_VIOLATION
      ? "You already have a skill with that name."
      : `Could not ${verb} the skill: ${error.message}`,
  );
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("A skill needs a name.");
  }
  if (trimmed.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error(
      `A skill name can be at most ${MAX_SKILL_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export async function createSkill(input: {
  name: string;
  instructions: string;
}) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("skills")
    .insert({ name: cleanName(input.name), instructions: input.instructions });
  if (error) {
    throw writeFailed(error, "create");
  }

  revalidatePath("/", "layout");
}

export async function updateSkill(
  skillId: string,
  input: { name: string; instructions: string },
) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("skills")
    .update({ name: cleanName(input.name), instructions: input.instructions })
    .eq("id", skillId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw writeFailed(error, "save");
  }
  if (!data) {
    throw new Error("Skill not found");
  }

  revalidatePath("/", "layout");
}

export async function deleteSkill(skillId: string) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { error } = await supabase.from("skills").delete().eq("id", skillId);
  if (error) {
    throw new Error(`Could not delete the skill: ${error.message}`);
  }

  revalidatePath("/", "layout");
}
