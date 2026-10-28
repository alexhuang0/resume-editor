import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contentEquals, type ItemContent } from "./reconcile";
import type { Item } from "./schema";

/**
 * Task 9.3: `contentEquals` compares wording only. The four content fields plus
 * the bullet list by (id, text, hidden) in order.
 *
 * **Validates: Requirements 10.3**
 *
 * The overlay-operand case (imported item vs `resolveItem(imported, bankById)`
 * rather than vs the raw bank entry) goes through the real export path, so it
 * lives in src/exporters/contentEqualsOverlay.test.ts.
 */

const base = (): Item => ({
  id: "i1",
  heading: "Acme",
  subheading: "Engineer",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two", hidden: true },
    { id: "b3", text: "three" },
  ],
});

describe("contentEquals: identity laws", () => {
  it("is reflexive", () => {
    const a = base();
    expect(contentEquals(a, a)).toBe(true);
    expect(contentEquals(base(), base())).toBe(true);
  });

  it("is symmetric, for equal and for different operands", () => {
    const a = base();
    const same = base();
    const diff = { ...base(), heading: "Other" };
    expect(contentEquals(a, same)).toBe(contentEquals(same, a));
    expect(contentEquals(a, diff)).toBe(contentEquals(diff, a));
    expect(contentEquals(a, diff)).toBe(false);
  });

  it("treats an item with no content at all as equal to itself and to another empty one", () => {
    expect(contentEquals({ bullets: [] }, { bullets: [] })).toBe(true);
  });

  it("does not mutate its operands", () => {
    const a = base();
    const b = { ...base(), heading: "Other" };
    const before = JSON.stringify([a, b]);
    contentEquals(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe("contentEquals: detects a change in each content field", () => {
  it.each(["heading", "subheading", "location", "dateRange"] as const)("%s", (key) => {
    const changed: Item = { ...base(), [key]: "something else" };
    expect(contentEquals(base(), changed)).toBe(false);
    expect(contentEquals(changed, base())).toBe(false);
  });

  it("a field present on one side and absent on the other is a difference", () => {
    const a = base();
    const { heading: _heading, ...withoutHeading } = base();
    expect(contentEquals(a, withoutHeading)).toBe(false);
    expect(contentEquals(withoutHeading, a)).toBe(false);
  });
});

describe("contentEquals: detects a change in the bullet list", () => {
  it("changed bullet text", () => {
    const b = base();
    b.bullets[0] = { ...b.bullets[0], text: "ONE" };
    expect(contentEquals(base(), b)).toBe(false);
  });

  it("changed bullet hidden flag, in both directions", () => {
    const hideFirst = base();
    hideFirst.bullets[0] = { ...hideFirst.bullets[0], hidden: true };
    expect(contentEquals(base(), hideFirst)).toBe(false);

    const showSecond = base();
    showSecond.bullets[1] = { ...showSecond.bullets[1], hidden: false };
    expect(contentEquals(base(), showSecond)).toBe(false);
  });

  it("changed bullet id (same text, same position)", () => {
    const b = base();
    b.bullets[1] = { ...b.bullets[1], id: "b2-regenerated" };
    expect(contentEquals(base(), b)).toBe(false);
  });

  it("reordered bullet list (same bullets, different order)", () => {
    const b = base();
    b.bullets = [b.bullets[2], b.bullets[0], b.bullets[1]];
    expect(contentEquals(base(), b)).toBe(false);
  });

  it("an added bullet, and a removed bullet", () => {
    const added = base();
    added.bullets = [...added.bullets, { id: "b4", text: "four" }];
    expect(contentEquals(base(), added)).toBe(false);
    expect(contentEquals(added, base())).toBe(false);

    const removed = base();
    removed.bullets = removed.bullets.slice(0, -1);
    expect(contentEquals(base(), removed)).toBe(false);
    expect(contentEquals(removed, base())).toBe(false);
  });

  it("a bullet list versus an empty one", () => {
    expect(contentEquals(base(), { ...base(), bullets: [] })).toBe(false);
  });
});

describe("contentEquals: normalization", () => {
  it("bullet hidden: undefined, absent and false are equal", () => {
    const a: Item = { ...base(), bullets: [{ id: "b1", text: "x", hidden: undefined }] };
    const b: Item = { ...base(), bullets: [{ id: "b1", text: "x", hidden: false }] };
    const c: Item = { ...base(), bullets: [{ id: "b1", text: "x" }] };
    expect(contentEquals(a, b)).toBe(true);
    expect(contentEquals(b, a)).toBe(true);
    expect(contentEquals(a, c)).toBe(true);
    expect(contentEquals(b, c)).toBe(true);
  });

  it("content fields: undefined, absent and \"\" are equal (all render as nothing)", () => {
    const empty: ItemContent = { bullets: [] };
    const explicitUndefined: ItemContent = {
      heading: undefined,
      subheading: undefined,
      location: undefined,
      dateRange: undefined,
      bullets: [],
    };
    const blank: ItemContent = {
      heading: "",
      subheading: "",
      location: "",
      dateRange: "",
      bullets: [],
    };
    for (const [x, y] of [
      [empty, explicitUndefined],
      [empty, blank],
      [explicitUndefined, blank],
    ]) {
      expect(contentEquals(x, y)).toBe(true);
      expect(contentEquals(y, x)).toBe(true);
    }
  });

  it("does not normalize anything that is visibly different text", () => {
    const pairs: [string, string][] = [
      ["Acme", "Acme "], // trailing space
      ["Acme", " Acme"], // leading space
      ["Acme", "acme"], // case
      ["", " "], // empty vs whitespace-only
      ["Acme Corp", "Acme  Corp"], // inner whitespace
    ];
    for (const [x, y] of pairs) {
      expect(contentEquals({ heading: x, bullets: [] }, { heading: y, bullets: [] })).toBe(false);
      expect(
        contentEquals(
          { bullets: [{ id: "b", text: x }] },
          { bullets: [{ id: "b", text: y }] }
        )
      ).toBe(false);
    }
  });

  it("bullet text is compared as-is: an empty bullet is not a missing bullet", () => {
    expect(contentEquals({ bullets: [{ id: "b", text: "" }] }, { bullets: [] })).toBe(false);
  });
});

describe("contentEquals: only wording counts", () => {
  it("ignores id, item-level hidden, link, hiddenBulletIds and bulletOrder", () => {
    const a = base();
    const b: Item = {
      ...base(),
      id: "a-different-item",
      hidden: true,
      link: { bankId: "bank1", detached: true },
      hiddenBulletIds: ["b1"],
      bulletOrder: ["b3", "b2", "b1"],
    };
    expect(contentEquals(a, b)).toBe(true);
    expect(contentEquals(b, a)).toBe(true);
  });

  it("ignores extra properties on the operands (BankItem, ResolvedItem)", () => {
    const entry = { ...base(), kind: "experience", updatedAt: "now", label: "L", orphaned: true };
    expect(contentEquals(base(), entry)).toBe(true);
  });
});

describe("contentEquals: properties", () => {
  const text = fc.string({ maxLength: 6 });
  const arbBullet = fc.record(
    { id: fc.constantFrom("a", "b", "c"), text, hidden: fc.boolean() },
    { requiredKeys: ["id", "text"] }
  );
  const arbContent: fc.Arbitrary<ItemContent> = fc.record(
    {
      heading: text,
      subheading: text,
      location: text,
      dateRange: text,
      bullets: fc.array(arbBullet, { maxLength: 4 }),
    },
    { requiredKeys: ["bullets"] }
  );

  it("is reflexive and symmetric for any pair of contents", () => {
    fc.assert(
      fc.property(arbContent, arbContent, (a, b) => {
        expect(contentEquals(a, a)).toBe(true);
        expect(contentEquals(a, b)).toBe(contentEquals(b, a));
      })
    );
  });
});
