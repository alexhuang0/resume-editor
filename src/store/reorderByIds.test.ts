import { describe, expect, it } from "vitest";
import { reorderByIds } from "./reorderByIds";

const mk = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("reorderByIds", () => {
  it("reorders items to follow orderedIds", () => {
    expect(ids(reorderByIds(mk("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("skips ids in orderedIds that are not in arr", () => {
    expect(ids(reorderByIds(mk("a", "b"), ["x", "b", "y", "a"]))).toEqual(["b", "a"]);
  });

  it("appends items not named in orderedIds in their original relative order", () => {
    expect(ids(reorderByIds(mk("a", "b", "c", "d"), ["c"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("returns arr order when orderedIds is empty", () => {
    expect(ids(reorderByIds(mk("a", "b"), []))).toEqual(["a", "b"]);
  });

  it("honors a repeated id only once, at its first occurrence", () => {
    expect(ids(reorderByIds(mk("a"), ["a", "a"]))).toEqual(["a"]);
    expect(ids(reorderByIds(mk("a", "b", "c"), ["c", "a", "c", "a"]))).toEqual(["c", "a", "b"]);
  });

  it("does not mutate its inputs", () => {
    const arr = mk("a", "b", "c");
    const order = ["c", "a"];
    const result = reorderByIds(arr, order);
    expect(ids(arr)).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["c", "a"]);
    expect(result).not.toBe(arr);
  });
});
