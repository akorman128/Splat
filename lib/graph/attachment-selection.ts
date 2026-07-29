import { ancestorsOf, type GraphEdgeRef, type GraphNodeRef } from "./ancestors";

export type AttachmentRef = {
  id: string;
  node_id: string | null;
  conversation_id: string;
  filename: string;
};

// The mirror of validateContextSelection, with one deliberate difference: the
// test is "the owning card is an ancestor", not "the owning card is in
// context". Re-sending a file while leaving its original question behind is a
// legitimate thing to want — the file is the evidence, the Q&A around it is
// not always worth the tokens.
export function validateAttachmentSelection({
  conversationId,
  parentId,
  attachments,
  nodes,
  edges,
}: {
  conversationId: string;
  parentId: string | null;
  attachments: AttachmentRef[];
  nodes: GraphNodeRef[];
  edges: GraphEdgeRef[];
}): string | null {
  if (attachments.length === 0) return null;

  const allowed = new Set<string>();
  if (parentId) {
    for (const id of ancestorsOf(parentId, nodes, edges)) allowed.add(id);
    allowed.add(parentId);
  }

  for (const attachment of attachments) {
    if (attachment.conversation_id !== conversationId) {
      return `${attachment.filename} belongs to a different conversation`;
    }
    // A draft has no owner yet — this is the card about to claim it.
    if (attachment.node_id === null) continue;
    if (!allowed.has(attachment.node_id)) {
      return `${attachment.filename} belongs to a card this one cannot see`;
    }
  }
  return null;
}
