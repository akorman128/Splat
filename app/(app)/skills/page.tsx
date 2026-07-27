import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NewSkillButton } from "@/components/skills/NewSkillButton";

export default async function SkillsPage() {
  const supabase = await createClient();
  const { data: skills } = await supabase
    .from("skills")
    .select("id, name, instructions")
    .order("name");

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
            <p className="text-sm text-muted-foreground">
              Reusable instructions you can attach to a prompt. Type{" "}
              <kbd className="rounded border px-1 font-mono text-xs">/</kbd> in
              the prompt box to pick one — it steers the answer without becoming
              part of the card.
            </p>
          </div>
          <NewSkillButton />
        </div>

        {(skills ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No skills yet. A good first one: how you want code reviewed, or
              the voice you want writing in.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(skills ?? []).map((skill) => (
              <li key={skill.id}>
                <Link
                  href={`/skills/${skill.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
                >
                  <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {skill.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {skill.instructions.trim() || "No instructions yet"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
