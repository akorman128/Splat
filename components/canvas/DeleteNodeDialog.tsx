"use client";

import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import { useComposerStore } from "@/lib/store/composer-store";
import {
  attachmentObjectPaths,
  removeAttachmentObjects,
} from "@/lib/attachments-client";
import { withDescendants } from "@/lib/graph/descendants";

export function DeleteNodeDialog() {
  const deletingNodeIds = useGraphStore((s) => s.deletingNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const setDeletingNodes = useGraphStore((s) => s.setDeletingNodes);

  const { targets, doomed } = useMemo(() => {
    const targets = deletingNodeIds.filter((id) => nodes[id]);
    return { targets, doomed: withDescendants(targets, Object.values(nodes)) };
  }, [deletingNodeIds, nodes]);

  const { mutate, isPending } = useMutation({
    mutationFn: async (ids: string[]) => {
      // The paths have to be read before the rows go — attachments cascade off
      // nodes, and once the row is gone so is the only copy of its storage
      // path. The objects themselves go afterwards: a delete that fails here
      // would otherwise leave the cards on the canvas with pills pointing at
      // files that no longer exist, which nothing on screen can recover from.
      // The other order round leaks objects, and the sweep reclaims those.
      const paths = await attachmentObjectPaths({ nodeIds: ids });
      const { error } = await createClient().from("nodes").delete().in("id", ids);
      if (error) throw new Error(error.message);
      await removeAttachmentObjects(paths);
      return ids;
    },
    onSuccess: (ids) => {
      const streams = useStreamStore.getState();
      for (const id of ids) streams.clear(id);
      const composer = useComposerStore.getState();
      if (composer.regenerateNodeId && ids.includes(composer.regenerateNodeId)) {
        composer.setRegenerateNode(null);
      }
      useGraphStore.getState().removeNodes(ids);
    },
    onError: (error: Error) =>
      toast.error("Could not delete", { description: error.message }),
  });

  if (targets.length === 0) return null;

  const first = nodes[targets[0]];
  const branching = doomed.length - targets.length;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) setDeletingNodes([]);
      }}
      title={targets.length === 1 ? "Delete card?" : `Delete ${targets.length} cards?`}
      description={
        <>
          {targets.length === 1 ? (
            <span className="font-medium text-foreground">
              {first.title ?? first.prompt}
            </span>
          ) : (
            `${targets.length} cards`
          )}{" "}
          will be deleted
          {branching > 0 &&
            `, along with the ${branching} card${branching === 1 ? "" : "s"} branching ${
              targets.length === 1 ? "from it" : "from them"
            }`}
          . This cannot be undone.
        </>
      }
      confirmLabel={isPending ? "Deleting…" : "Delete"}
      pending={isPending}
      onConfirm={() => mutate(doomed)}
    />
  );
}
