import { GraphHydrator } from "@/components/canvas/GraphHydrator";

// An empty canvas with nothing behind it. The conversation is written when the
// first prompt is sent, so a draft the user walks away from costs nothing.
export default function NewConversationPage() {
  return (
    <GraphHydrator
      conversationId={null}
      nodes={[]}
      edges={[]}
      suggestions={[]}
      attachments={[]}
    />
  );
}
