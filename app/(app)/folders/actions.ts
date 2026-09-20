"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { MAX_FOLDER_NAME_LENGTH } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

function writeFailed(
  error: { code: string; message: string },
  verb: string,
): Error {
  return new Error(
    error.code === UNIQUE_VIOLATION
      ? "You already have a folder with that name."
      : `Could not ${verb} the folder: ${error.message}`,
  );
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("A folder needs a name.");
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error(
      `A folder name can be at most ${MAX_FOLDER_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export async function createFolder(name: string): Promise<string> {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("folders")
    .insert({ name: cleanName(name) })
    .select("id")
    .single();
  if (error) {
    throw writeFailed(error, "create");
  }

  revalidatePath("/", "layout");
  return data.id;
}

export async function renameFolder(folderId: string, name: string) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("folders")
    .update({ name: cleanName(name) })
    .eq("id", folderId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw writeFailed(error, "rename");
  }
  if (!data) {
    throw new Error("Folder not found");
  }

  revalidatePath("/", "layout");
}

export async function deleteFolder(folderId: string) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    redirect("/login");
  }

  const { error } = await supabase.from("folders").delete().eq("id", folderId);
  if (error) {
    throw new Error(`Could not delete the folder: ${error.message}`);
  }

  revalidatePath("/", "layout");
}
