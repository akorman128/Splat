type Clip = {
  url: string | null;
  ready: Promise<string>;
  controller: AbortController;
};

// How far ahead to have audio ready, in seconds of listening rather than in
// sections: a run of "Yeah." and "Okay." is a dozen requests for a few seconds
// of sound, and each one takes longer to generate than to play.
const BUFFER_SECONDS = 45;
const MIN_AHEAD = 2;
const MAX_PARALLEL = 6;
// Roughly how fast Kokoro reads at 1×; only used to size the buffer.
const CHARS_PER_SECOND = 15;

export async function speechError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Could not read this section aloud (${res.status}).`;
}

export class ClipQueue {
  private clips = new Map<number, Clip>();
  private failed = new Set<number>();
  private wanted: number[] = [];
  private readonly url: (index: number) => string;
  private readonly lengths: number[];

  constructor(url: (index: number) => string, lengths: number[]) {
    this.url = url;
    this.lengths = lengths;
  }

  get(index: number): Clip | undefined {
    return this.clips.get(index);
  }

  // Anything outside the new window or `keep` is let go: an hour of speech is
  // about 60 MB held in memory, and a request for a passage the listener has
  // jumped away from would hold a slot the new window needs. Dropping a clip
  // is cheap once it has been generated, since the route keeps it.
  plan(from: number, keep: number[], speed: number) {
    const wanted: number[] = [];
    let seconds = 0;
    for (let index = Math.max(0, from); index < this.lengths.length; index++) {
      if (wanted.length >= MIN_AHEAD && seconds >= BUFFER_SECONDS) break;
      wanted.push(index);
      seconds += this.lengths[index] / CHARS_PER_SECOND / speed;
    }
    this.wanted = wanted;

    const keeping = new Set([...wanted, ...keep]);
    for (const index of [...this.clips.keys()]) {
      if (!keeping.has(index)) this.drop(index);
    }
    this.pump();
  }

  drop(index: number) {
    const clip = this.clips.get(index);
    if (!clip) return;
    this.clips.delete(index);
    clip.controller.abort();
    if (clip.url) URL.revokeObjectURL(clip.url);
  }

  retry(index: number) {
    this.failed.delete(index);
  }

  dispose() {
    for (const index of [...this.clips.keys()]) this.drop(index);
    this.wanted = [];
  }

  private pump() {
    let inFlight = 0;
    for (const clip of this.clips.values()) if (!clip.url) inFlight++;

    for (const index of this.wanted) {
      if (inFlight >= MAX_PARALLEL) break;
      if (this.clips.has(index) || this.failed.has(index)) continue;
      this.fetch(index);
      inFlight++;
    }
  }

  // A failure is remembered rather than retried by the pump, so a missing key
  // is one error and not a request loop; playing the section asks again.
  private fetch(index: number) {
    const controller = new AbortController();
    const clip: Clip = {
      url: null,
      controller,
      ready: fetch(this.url(index), { signal: controller.signal }).then(
        async (res) => {
          if (!res.ok) throw new Error(await speechError(res));
          const url = URL.createObjectURL(await res.blob());
          if (this.clips.get(index) !== clip) {
            URL.revokeObjectURL(url);
            throw new Error("Dropped");
          }
          clip.url = url;
          return url;
        },
      ),
    };
    this.clips.set(index, clip);
    clip.ready
      .catch(() => {
        if (this.clips.get(index) !== clip) return;
        this.clips.delete(index);
        this.failed.add(index);
      })
      .finally(() => this.pump());
  }
}
