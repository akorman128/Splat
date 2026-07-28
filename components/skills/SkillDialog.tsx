"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  createSkill,
  deleteSkill,
  updateSkill,
} from "@/app/(app)/skills/actions";
import { MAX_SKILL_NAME_LENGTH } from "@/lib/types";

export type SkillTarget = { kind: "new" } | { kind: "edit"; skillId: string };

type Draft = { name: string; instructions: string };

const BLANK: Draft = { name: "", instructions: "" };

export function SkillDialog({
  target,
  onOpenChange,
}: {
  target: SkillTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The dialog stays mounted between skills, so each one is reset as it opens.
  // A new skill starts blank and only reaches the database on save; an existing
  // one is read here because instructions are deliberately kept off the
  // sidebar's payload.
  const [shown, setShown] = useState<SkillTarget | null>(null);
  if (target !== shown) {
    setShown(target);
    setMissing(false);
    setSaved(target?.kind === "new" ? BLANK : null);
    if (target?.kind === "new") {
      setName(BLANK.name);
      setInstructions(BLANK.instructions);
    }
  }

  useEffect(() => {
    if (target?.kind !== "edit") return;
    let cancelled = false;
    createClient()
      .from("skills")
      .select("name, instructions")
      .eq("id", target.skillId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          setMissing(true);
          return;
        }
        setSaved(data);
        setName(data.name);
        setInstructions(data.instructions);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const dirty =
    saved !== null &&
    (name !== saved.name || instructions !== saved.instructions);

  async function save() {
    if (!target || !saved || saving || !name.trim()) return;
    setSaving(true);
    try {
      if (target.kind === "edit") {
        await updateSkill(target.skillId, { name, instructions });
      } else {
        await createSkill({ name, instructions });
      }
      onOpenChange(false);
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
    if (target?.kind !== "edit") return;
    setDeleting(true);
    try {
      await deleteSkill(target.skillId);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the skill",
      );
    } finally {
      setDeleting(false);
    }
  }

  const creating = target?.kind === "new";

  return (
    <>
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && (saving || deleting)) return;
          onOpenChange(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{creating ? "New skill" : "Skill"}</DialogTitle>
            <DialogDescription>
              Reusable instructions you can attach to a prompt. Type{" "}
              <span className="font-mono">/</span> in the prompt box to pick one
              — it steers the answer without becoming part of the card.
            </DialogDescription>
          </DialogHeader>

          {missing ? (
            <p className="text-sm text-muted-foreground">
              This skill could not be opened — it may already have been deleted.
            </p>
          ) : !saved ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
              className="grid gap-4"
            >
              <div className="space-y-2">
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  autoFocus={creating}
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

              <div className="space-y-2">
                <Label htmlFor="skill-instructions">Instructions</Label>
                <Textarea
                  id="skill-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="You are a meticulous code reviewer. Lead with correctness, then clarity…"
                  className="min-h-56 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Sent as the model&apos;s instructions alongside the prompt,
                  ahead of any cards you include as context.
                </p>
              </div>

              <DialogFooter>
                {!creating && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive sm:mr-auto"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                )}
                <DialogClose
                  render={<Button type="button" variant="outline" />}
                  className={creating ? "sm:ml-auto" : undefined}
                >
                  Cancel
                </DialogClose>
                <Button
                  type="submit"
                  disabled={saving || !name.trim() || !dirty}
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {creating ? "Create" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete && saved !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmingDelete(false);
        }}
        title="Delete skill?"
        description={
          <>
            <span className="font-medium text-foreground">{saved?.name}</span>{" "}
            will stop being offered in the prompt box. Cards already made with it
            keep the instructions they were sent.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onConfirm={remove}
      />
    </>
  );
}
