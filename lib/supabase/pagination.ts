// Stops on an empty page rather than a short one: PostgREST's db-max-rows may
// be lower than the page asked for.
const PAGE = 1000;

export async function selectAllPages<Row, Err>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: Err | null }>,
): Promise<{ rows: Row[]; error: Err | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    from += data.length;
  }
  return { rows, error: null };
}
