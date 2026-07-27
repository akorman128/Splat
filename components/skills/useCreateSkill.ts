"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSkill } from "@/app/(app)/skills/actions";

export function useCreateSkill() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createSkill();
      router.push(`/skills/${id}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create a skill",
      );
    } finally {
      setCreating(false);
    }
  }

  return { create, creating };
}
