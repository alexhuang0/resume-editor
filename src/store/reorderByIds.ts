// Pure helper shared by the store and the resolver. Kept in its own module so
// resolve.ts can use it without importing zustand/persist via resumeStore.

/**
 * Reorder `arr` to follow `orderedIds`. Ids in `orderedIds` that are not in
 * `arr` are skipped; repeated ids are honored only at their first occurrence,
 * so no item appears twice; items of `arr` not named in `orderedIds` are
 * appended in their original relative order. Inputs are not mutated.
 */
export function reorderByIds<T extends { id: string }>(arr: T[], orderedIds: string[]): T[] {
  const byId = new Map(arr.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const id of orderedIds) {
    const found = byId.get(id);
    if (found && !seen.has(id)) {
      seen.add(id);
      result.push(found);
    }
  }
  for (const x of arr) {
    if (!seen.has(x.id)) result.push(x);
  }
  return result;
}
