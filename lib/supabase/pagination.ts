// PostgREST caps a select at db-max-rows — 1000 by default — and a short read
// is not a smaller answer but a wrong one wherever the rows drive a delete. The
// loop stops on an empty page rather than a short one, because the server's cap
// is what it is and may be lower than the page asked for.
//
// The error is returned rather than handled: one caller treats a failed read as
// fatal, the other logs it and carries on with what it has.
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
