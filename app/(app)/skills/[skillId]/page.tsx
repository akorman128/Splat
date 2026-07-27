import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SkillEditor } from "@/components/skills/SkillEditor";

export default async function SkillPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  const supabase = await createClient();

  const { data: skill } = await supabase
    .from("skills")
    .select("id, name, instructions")
    .eq("id", skillId)
    .maybeSingle();
  if (!skill) notFound();

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <SkillEditor skill={skill} />
      </div>
    </div>
  );
}
