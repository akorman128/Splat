"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authClaims } from "@/lib/supabase/claims";
import { DEFAULT_SKILL_NAME, MAX_SKILL_NAME_LENGTH } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";
const UNTITLED_LIMIT = 20;

// Returns the new id rather than redirecting: both callers are client
// components that navigate themselves, and a thrown error stays catchable.
export async function createSkill(): Promise<string> {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  // Names are unique per owner, so a second untitled skill needs a suffix.
  for (let attempt = 1; attempt <= UNTITLED_LIMIT; attempt++) {
    const name =
      attempt === 1 ? DEFAULT_SKILL_NAME : `${DEFAULT_SKILL_NAME} ${attempt}`;
    const { data, error } = await supabase
      .from("skills")
      .insert({ name })
      .select("id")
      .single();
    if (data) {
      revalidatePath("/", "layout");
      return data.id;
    }
    if (error?.code !== UNIQUE_VIOLATION) {
      throw new Error(`Could not create a skill: ${error?.message}`);
    }
  }

  throw new Error("Name your untitled skills before creating another.");
}

export async function updateSkill(
  skillId: string,
  input: { name: string; instructions: string },
) {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("A skill needs a name.");
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error(
      `A skill name can be at most ${MAX_SKILL_NAME_LENGTH} characters.`,
    );
  }

  const { data, error } = await supabase
    .from("skills")
    .update({ name, instructions: input.instructions })
    .eq("id", skillId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(
      error.code === UNIQUE_VIOLATION
        ? "You already have a skill with that name."
        : `Could not save the skill: ${error.message}`,
    );
  }
  if (!data) {
    throw new Error("Skill not found");
  }

  revalidatePath("/", "layout");
}

export async function deleteSkill(skillId: string) {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    redirect("/login");
  }

  const { error } = await supabase.from("skills").delete().eq("id", skillId);
  if (error) {
    throw new Error(`Could not delete the skill: ${error.message}`);
  }

  revalidatePath("/", "layout");
}
