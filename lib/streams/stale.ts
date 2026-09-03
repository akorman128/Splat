// Deliberately not server-only: the browser needs the same definition of
// "abandoned" the server uses, so a page that stays open can notice a card
// nobody is filling any more.

// Past the chat route's own ceiling (its maxDuration, plus room for the final
// write). A run still claiming a card after this is not slow, it is gone.
export const STALE_STREAM_MS = 330_000;

export const INTERRUPTED_MESSAGE =
  "Generation stopped before it finished. Retry to run it again.";

// Streaming is a claim one run makes on one card. The run touches the row every
// couple of seconds while it works, so a claim older than the ceiling belongs to
// a run that was killed before it could write anything — a deploy, an eviction,
// a hard timeout.
export function isStaleStream(node: {
  status: string;
  updated_at: string;
}): boolean {
  return (
    node.status === "streaming" &&
    Date.now() - Date.parse(node.updated_at) > STALE_STREAM_MS
  );
}
