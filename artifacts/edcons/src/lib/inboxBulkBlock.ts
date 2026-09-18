export type BulkBlockResult = { succeeded: number; failed: number[] };

/** Each request is authorized server-side; never retry uncertain external effects. */
export async function runInboxBulkBlock(ids: number[], action: (id: number) => Promise<void>): Promise<BulkBlockResult> {
  const unique = [...new Set(ids)];
  if (unique.length > 100 || unique.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid block selection");
  let succeeded = 0;
  const failed: number[] = [];
  for (let index = 0; index < unique.length; index += 4) {
    await Promise.all(unique.slice(index, index + 4).map(async id => {
      try { await action(id); succeeded++; }
      catch { failed.push(id); }
    }));
  }
  return { succeeded, failed };
}
