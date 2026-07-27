"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteSkill, updateSkill } from "@/app/(app)/skills/actions";
import { MAX_SKILL_NAME_LENGTH } from "@/lib/types";

export function SkillEditor({
  skill,
}: {
  skill: { id: string; name: string; instructions: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(skill.name);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== skill.name || instructions !== skill.instructions;

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await updateSkill(skill.id, { name, instructions });
      toast.success("Skill saved");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the skill",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteSkill(skill.id);
      setConfirmingDelete(false);
      router.push("/skills");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the skill",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-6"
    >
      <div className="space-y-3">
        <Link
          href="/skills"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All skills
        </Link>
        <div className="space-y-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            maxLength={MAX_SKILL_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Code reviewer"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            What you&apos;ll type after <code>/</code> in the prompt box.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="skill-instructions">Instructions</Label>
        <Textarea
          id="skill-instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="You are a meticulous code reviewer. Lead with correctness, then clarity…"
          className="min-h-72 font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Sent as the model&apos;s instructions alongside the prompt, ahead of
          any cards you include as context.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || !name.trim() || !dirty}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {dirty ? "Save" : "Saved"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmingDelete(false);
        }}
        title="Delete skill?"
        description={
          <>
            <span className="font-medium text-foreground">{skill.name}</span>{" "}
            will stop being offered in the prompt box. Cards already made with
            it keep the instructions they were sent.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onConfirm={remove}
      />
    </form>
  );
}
