"use client";

import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateSkill } from "./useCreateSkill";

export function NewSkillButton() {
  const { create, creating } = useCreateSkill();

  return (
    <Button onClick={create} disabled={creating}>
      {creating ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Plus className="size-4" />
      )}
      New skill
    </Button>
  );
}
