// Shared fast-check arbitraries for the resolver property tests (spec
// item-bank-and-editor-ux, Properties 2, 3, 4, 6, 7, 9). Deliberately NOT a
// `.test.ts` file: vitest's include globs skip it, but `tsc -b` still type-checks it.
//
// Conventions:
//  - Every arbitrary yields plain JSON-safe data (a JSON round trip is the last
//    step), so `toStrictEqual` never trips on null prototypes or `undefined` keys.
//  - Ids are drawn from small alphabets with prefixes (`bank-`, `bul-`, `item-`,
//    `sec-`) so overlays routinely collide with real ids, and dangling ids carry
//    a prefix (`missing-`) that can never match a generated bank id.
//  - Bank ids, bullet ids within one list, item ids and section ids are unique.
import fc from "fast-check";
import type {
  Bullet,
  BankItem,
  Item,
  ItemLink,
  Resume,
  Section,
  SectionKind,
} from "./schema";

const text = fc.string({ maxLength: 20 });
const flag = fc.boolean();

/** JSON round trip: plain prototypes, no `undefined` values. */
function plain<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return arb.map((v) => JSON.parse(JSON.stringify(v)) as T);
}

const KINDS: SectionKind[] = ["education", "experience", "projects", "skills", "custom"];
export const arbSectionKind: fc.Arbitrary<SectionKind> = fc.constantFrom(...KINDS);

/** Bullet ids are `bul-0`..`bul-9`: small space so stale/overlapping ids happen. */
const bulletId = fc.integer({ min: 0, max: 9 }).map((n) => `bul-${n}`);

export const arbBullet: fc.Arbitrary<Bullet> = plain(
  fc.record({ id: bulletId, text, hidden: flag }, { requiredKeys: ["id", "text"] })
);

/** Bullets with unique ids (a bank entry or an item never repeats a bullet id). */
export const arbBullets = (maxLength = 6): fc.Arbitrary<Bullet[]> =>
  fc.uniqueArray(arbBullet, { maxLength, selector: (b) => b.id });

/** A bank entry. Ids are supplied by `arbBank`; standalone use gets `bank-0`..`bank-9`. */
export const arbBankItem: fc.Arbitrary<BankItem> = plain(
  fc.record(
    {
      id: fc.integer({ min: 0, max: 9 }).map((n) => `bank-${n}`),
      kind: arbSectionKind,
      label: text,
      heading: text,
      subheading: text,
      location: text,
      dateRange: text,
      bullets: arbBullets(),
      updatedAt: text,
    },
    { requiredKeys: ["id", "kind", "bullets", "updatedAt"] }
  )
);

/** A bank (possibly empty) with unique ids. */
export const arbBank = (maxLength = 5): fc.Arbitrary<BankItem[]> =>
  fc.uniqueArray(arbBankItem, { maxLength, selector: (b) => b.id });

/** An id guaranteed not to be in any generated bank. */
const danglingId = fc.integer({ min: 0, max: 9 }).map((n) => `missing-${n}`);

/**
 * A `bankId` for an item. With a non-empty `bank`, resolves to an entry with
 * probability `1 - danglingRate`; otherwise (or with an empty bank) dangles.
 * `danglingRate` is clamped to [0, 1]: 0 always resolves (if the bank allows), 1 always dangles.
 */
export function arbBankId(bank: readonly BankItem[], danglingRate = 0.3): fc.Arbitrary<string> {
  if (bank.length === 0 || danglingRate >= 1) return danglingId;
  const existing = fc.constantFrom(...bank.map((b) => b.id));
  if (danglingRate <= 0) return existing;
  return fc
    .tuple(fc.integer({ min: 0, max: 99 }), existing, danglingId)
    .map(([roll, hit, miss]) => (roll < danglingRate * 100 ? miss : hit));
}

const itemContent = {
  heading: text,
  subheading: text,
  location: text,
  dateRange: text,
};

const itemId = fc.integer({ min: 0, max: 99 }).map((n) => `item-${n}`);

/** Overlay id list: a mix of real bullet ids (from `pool`) and stale ones, in any order, maybe with repeats. */
function arbIdList(pool: readonly Bullet[]): fc.Arbitrary<string[]> {
  const real = pool.length ? [fc.constantFrom(...pool.map((b) => b.id))] : [];
  return fc.array(fc.oneof(bulletId, ...real), { maxLength: 8 });
}

/**
 * Overlay (`hiddenBulletIds` / `bulletOrder`) for a bank entry's bullets. Each key
 * is independently absent, empty, or populated. Populated lists include ids
 * absent from the entry (stale), partial orderings, and any permutation.
 */
export function arbOverlay(
  pool: readonly Bullet[] = []
): fc.Arbitrary<Pick<Item, "hiddenBulletIds" | "bulletOrder">> {
  return plain(
    fc.record(
      { hiddenBulletIds: arbIdList(pool), bulletOrder: arbIdList(pool) },
      { requiredKeys: [] }
    )
  );
}

/** A local item: no `link`. Optionally carries stray overlay fields (resolution must still ignore them). */
export const arbLocalItem: fc.Arbitrary<Item> = plain(
  fc.record(
    {
      id: itemId,
      ...itemContent,
      hidden: flag,
      bullets: arbBullets(),
      hiddenBulletIds: arbIdList([]),
      bulletOrder: arbIdList([]),
    },
    { requiredKeys: ["id", "bullets"] }
  )
);

/**
 * A detached item: `link: { bankId, detached: true }` plus its own content.
 * `bank` / `danglingRate` control whether `bankId` names a real entry (whose
 * wording is independent of the item's own).
 */
export function arbDetachedItem(bank: readonly BankItem[] = [], danglingRate = 0.3): fc.Arbitrary<Item> {
  return fc
    .tuple(arbLocalItem, arbBankId(bank, danglingRate))
    .map(([it, bankId]) => ({ ...it, link: { bankId, detached: true } as ItemLink }))
    .map((it) => JSON.parse(JSON.stringify(it)) as Item);
}

/**
 * A linked item: `link: { bankId }` (or `detached: false`), empty own content
 * and bullets as the store maintains them, and an overlay whose ids are drawn
 * from the referenced entry's bullets (when it exists) plus stale ids.
 * `danglingRate` is the chance `bankId` names no entry.
 */
export function arbLinkedItem(bank: readonly BankItem[], danglingRate = 0.3): fc.Arbitrary<Item> {
  return arbBankId(bank, danglingRate).chain((bankId) => {
    const entry = bank.find((b) => b.id === bankId);
    return plain(
      fc.record(
        {
          id: itemId,
          hidden: flag,
          link: fc.record(
            { bankId: fc.constant(bankId), detached: fc.constant(false) },
            { requiredKeys: ["bankId"] }
          ),
          bullets: fc.constant([] as Bullet[]),
          hiddenBulletIds: arbIdList(entry?.bullets ?? []),
          bulletOrder: arbIdList(entry?.bullets ?? []),
        },
        { requiredKeys: ["id", "bullets", "link"] }
      )
    ) as fc.Arbitrary<Item>;
  });
}

/** A non-empty bank with unique ids. */
export const arbNonEmptyBank = (maxLength = 5): fc.Arbitrary<BankItem[]> =>
  fc.uniqueArray(arbBankItem, { minLength: 1, maxLength, selector: (b) => b.id });

/**
 * A linked item whose `bankId` always names an entry of `bank` (must be
 * non-empty) but which ALSO carries stray local wording: heading/subheading/
 * location/dateRange and own bullets (ids may collide with the entry's, text
 * differs). The store keeps these empty; the resolver must ignore them anyway.
 */
export function arbLinkedItemWithStrayContent(bank: readonly BankItem[]): fc.Arbitrary<Item> {
  return fc
    .tuple(
      arbLinkedItem(bank, 0),
      plain(
        fc.record(
          { ...itemContent, bullets: arbBullets() },
          { requiredKeys: ["bullets"] }
        )
      )
    )
    .map(([linked, stray]) => ({
      ...linked,
      ...stray,
      bullets: stray.bullets.map((b) => ({ ...b, text: `stray-${b.text}` })),
    }));
}

/** Any item: local, detached, or linked, with `bankId`s resolving against `bank` unless dangling. */
export function arbItem(bank: readonly BankItem[] = [], danglingRate = 0.3): fc.Arbitrary<Item> {
  return fc.oneof(arbLocalItem, arbDetachedItem(bank, danglingRate), arbLinkedItem(bank, danglingRate));
}

/** Only local and detached items (the domain of Property 2). */
export function arbUnlinkedItem(bank: readonly BankItem[] = [], danglingRate = 0.3): fc.Arbitrary<Item> {
  return fc.oneof(arbLocalItem, arbDetachedItem(bank, danglingRate));
}

/** A section whose items come from `arbItemFn`, with unique item ids. */
export function arbSection(
  arbItemFn: fc.Arbitrary<Item>,
  maxItems = 4
): fc.Arbitrary<Section> {
  return plain(
    fc.record({
      id: fc.integer({ min: 0, max: 99 }).map((n) => `sec-${n}`),
      kind: arbSectionKind,
      title: text,
      hidden: flag,
      items: fc.uniqueArray(arbItemFn, { maxLength: maxItems, selector: (i) => i.id }),
    }, { requiredKeys: ["id", "kind", "title", "items"] })
  );
}

/** A valid v3 resume whose items come from `arbItemFn` (unique section ids). */
export function arbResume(arbItemFn: fc.Arbitrary<Item>, maxSections = 4): fc.Arbitrary<Resume> {
  return plain(
    fc.record(
      {
        schemaVersion: fc.constant(3 as const),
        id: fc.string({ minLength: 1, maxLength: 8 }),
        name: text,
        updatedAt: text,
        font: fc.constantFrom("latin-modern", "system-serif"),
        header: fc.record({
          fullName: text,
          fields: fc.array(
            fc.record(
              { id: fc.string({ minLength: 1, maxLength: 6 }), label: text, url: text, hidden: flag },
              { requiredKeys: ["id", "label"] }
            ),
            { maxLength: 3 }
          ),
        }),
        sections: fc.uniqueArray(arbSection(arbItemFn), {
          maxLength: maxSections,
          selector: (s) => s.id,
        }),
      },
      { requiredKeys: ["schemaVersion", "id", "name", "updatedAt", "header", "sections"] }
    )
  ) as fc.Arbitrary<Resume>;
}

export interface ResumeAndBank {
  bank: BankItem[];
  resume: Resume;
}

/**
 * A v3 resume and the bank it was generated against. Items mix all three link
 * states; linked/detached `bankId`s resolve against `bank` except for a
 * `danglingRate` fraction (default 0.3).
 */
export function arbResumeAndBank(opts: { danglingRate?: number } = {}): fc.Arbitrary<ResumeAndBank> {
  const danglingRate = opts.danglingRate ?? 0.3;
  return arbBank().chain((bank) =>
    arbResume(arbItem(bank, danglingRate)).map((resume) => ({ bank, resume }))
  );
}

/** Like `arbResumeAndBank` but the resume holds only local and detached items. */
export function arbUnlinkedResumeAndBank(opts: { danglingRate?: number } = {}): fc.Arbitrary<ResumeAndBank> {
  const danglingRate = opts.danglingRate ?? 0.3;
  return arbBank().chain((bank) =>
    arbResume(arbUnlinkedItem(bank, danglingRate)).map((resume) => ({ bank, resume }))
  );
}

export interface ItemScenario {
  /** Non-empty bank (a linked target's entry, when it has one, is always present). */
  bank: BankItem[];
  /** Two variants (`variant-a`, `variant-b`), for loading into the real store. */
  variants: Resume[];
  /** The current variant (`variant-a`), which holds the target item. */
  currentVariantId: string;
  sectionId: string;
  itemId: string;
}

export type LinkedItemScenario = ItemScenario;

/**
 * A store-ready scenario around ONE target item produced by `arbTarget` (given
 * the generated bank). The item lives in a section of variant A at a random
 * position among other items of any link state; the section sits at a random
 * position among other sections. Variant B is an independent resume (it may even
 * reuse the target's section and item ids) used to check that edits never leak
 * across variants. The target's item id and section id are unique within
 * variant A, so lookups by (sectionId, itemId) are unambiguous.
 */
function arbScenarioAround(
  arbTarget: (bank: readonly BankItem[]) => fc.Arbitrary<Item>
): fc.Arbitrary<ItemScenario> {
  return arbNonEmptyBank().chain((bank) =>
    fc
      .tuple(
        arbTarget(bank),
        arbResume(arbItem(bank)),
        arbResume(arbItem(bank)),
        arbSection(arbItem(bank)),
        fc.nat(),
        fc.nat()
      )
      .map(([target, resumeA, resumeB, host, itemAt, sectionAt]) => {
        const others = host.items.filter((i) => i.id !== target.id);
        const at = itemAt % (others.length + 1);
        const hostSection: Section = {
          ...host,
          items: [...others.slice(0, at), target, ...others.slice(at)],
        };
        const rest = resumeA.sections.filter((s) => s.id !== host.id);
        const sat = sectionAt % (rest.length + 1);
        const variantA: Resume = {
          ...resumeA,
          id: "variant-a",
          sections: [...rest.slice(0, sat), hostSection, ...rest.slice(sat)],
        };
        const variantB: Resume = { ...resumeB, id: "variant-b" };
        return {
          bank,
          variants: [variantA, variantB],
          currentVariantId: variantA.id,
          sectionId: hostSection.id,
          itemId: target.id,
        };
      })
  );
}

/**
 * A scenario around ONE linked item whose bank entry exists (empty own bullets,
 * overlay ids drawn from the entry's bullets plus stale ones).
 */
export function arbLinkedItemScenario(): fc.Arbitrary<LinkedItemScenario> {
  return arbScenarioAround((bank) => arbLinkedItem(bank, 0));
}

/** A scenario around ONE local item (no `link`; may carry stray overlay keys). */
export function arbLocalItemScenario(): fc.Arbitrary<ItemScenario> {
  return arbScenarioAround(() => arbLocalItem);
}

/**
 * A scenario around ONE detached item with its own wording and bullets (some
 * flagged hidden). `danglingRate` is the chance its `bankId` names no entry
 * (default 0: the entry always exists).
 */
export function arbDetachedItemScenario(danglingRate = 0): fc.Arbitrary<ItemScenario> {
  return arbScenarioAround((bank) => arbDetachedItem(bank, danglingRate));
}

export interface TwoVariantSharedEntryScenario {
  /** Non-empty bank; `entryId` names one of its entries. */
  bank: BankItem[];
  /** `variant-a` and `variant-b`, each holding a linked item to `entryId`. */
  variants: [Resume, Resume];
  /** The entry both items link to. */
  entryId: string;
  /** Host section ids, `[inVariantA, inVariantB]` (may coincide). */
  sectionIds: [string, string];
  /** Item ids, `[inVariantA, inVariantB]` (may coincide). */
  itemIds: [string, string];
}

/**
 * A store-ready library for Property 5: ONE bank entry and two variants
 * (`variant-a`, `variant-b`) that each contain an item linked to it, with
 * independently generated overlays (stale ids and repeats included). Each
 * linked item sits at a random position in a random section among decoy items
 * (any link state, any entry). Item ids are unique within a variant; ids and
 * section ids may coincide across variants, so lookups that forget the variant
 * would be caught.
 */
export function arbTwoVariantSharedEntryScenario(): fc.Arbitrary<TwoVariantSharedEntryScenario> {
  return arbNonEmptyBank().chain((bank) =>
    fc.constantFrom(...bank.map((b) => b.id)).chain((entryId) => {
      const entry = bank.find((b) => b.id === entryId)!;
      const arbSide = fc.tuple(
        arbLinkedItem([entry], 0),
        arbResume(arbItem(bank)),
        arbSection(arbItem(bank)),
        fc.nat(),
        fc.nat()
      );
      const build = (
        id: string,
        [target, resume, host, itemAt, sectionAt]: [Item, Resume, Section, number, number]
      ) => {
        const others = host.items.filter((i) => i.id !== target.id);
        const at = itemAt % (others.length + 1);
        const hostSection: Section = {
          ...host,
          items: [...others.slice(0, at), target, ...others.slice(at)],
        };
        const rest = resume.sections.filter((s) => s.id !== host.id);
        const sat = sectionAt % (rest.length + 1);
        const variant: Resume = {
          ...resume,
          id,
          sections: [...rest.slice(0, sat), hostSection, ...rest.slice(sat)],
        };
        return { variant, sectionId: hostSection.id, itemId: target.id };
      };
      return fc.tuple(arbSide, arbSide).map(([sa, sb]) => {
        const a = build("variant-a", sa);
        const b = build("variant-b", sb);
        return {
          bank,
          variants: [a.variant, b.variant] as [Resume, Resume],
          entryId,
          sectionIds: [a.sectionId, b.sectionId] as [string, string],
          itemIds: [a.itemId, b.itemId] as [string, string],
        };
      });
    })
  );
}

export interface DeleteBankItemScenario {
  /** Non-empty bank; `targetId` names one of its entries. */
  bank: BankItem[];
  /** 1–3 variants (`variant-0`..), each with at least one section. */
  variants: Resume[];
  currentVariantId: string;
  /** The entry to delete. */
  targetId: string;
  /** How many items (linked or detached, any variant or section) reference `targetId`. */
  refCount: number;
}

/** A detached item the way the store keeps it: own wording, no overlay keys. */
function stripOverlay(item: Item): Item {
  const { hiddenBulletIds: _h, bulletOrder: _o, ...rest } = item;
  return rest;
}

/**
 * A library built around ONE chosen bank entry (spec item-bank-and-editor-ux,
 * Property 14). The entry is referenced 0, 1, or 2–6 times, with the references
 * spread across variants, sections and positions, mixing linked items (with
 * overlays) and detached items (with their own wording). Everything else is a
 * decoy: local items, items linked or detached to OTHER entries, and a few
 * dangling links. Item ids are unique within a variant, section ids within a
 * variant; ids repeat across variants.
 */
export function arbDeleteBankItemScenario(): fc.Arbitrary<DeleteBankItemScenario> {
  return arbNonEmptyBank().chain((bank) =>
    fc.constantFrom(...bank.map((b) => b.id)).chain((targetId) => {
      const target = bank.find((b) => b.id === targetId)!;
      const others = bank.filter((b) => b.id !== targetId);
      const arbDecoy = fc.oneof(
        arbLocalItem,
        arbLinkedItem(others, 0.2),
        arbDetachedItem(others, 0.2).map(stripOverlay)
      );
      const arbRef = fc.oneof(
        arbLinkedItem([target], 0),
        arbDetachedItem([target], 0).map(stripOverlay)
      );
      const arbPlacement = fc.record({
        item: arbRef,
        variant: fc.nat(),
        section: fc.nat(),
        at: fc.nat(),
      });
      const arbRefCount = fc.oneof(
        fc.constant(0),
        fc.constant(1),
        fc.integer({ min: 2, max: 6 })
      );
      return fc
        .tuple(
          fc.array(arbResume(arbDecoy, 3), { minLength: 1, maxLength: 3 }),
          arbRefCount.chain((n) => fc.array(arbPlacement, { minLength: n, maxLength: n }))
        )
        .map(([resumes, placements]) => {
          const variants = resumes.map((r, vi): Resume => ({
            ...r,
            id: `variant-${vi}`,
            sections: (r.sections.length
              ? r.sections
              : [{ id: "empty", kind: "custom" as const, title: "", items: [] }]
            ).map((s) => ({ ...s, items: [...s.items] })),
          }));
          for (const p of placements) {
            const v = variants[p.variant % variants.length];
            const sec = v.sections[p.section % v.sections.length];
            sec.items.splice(p.at % (sec.items.length + 1), 0, p.item);
          }
          // Re-id after placement so ids stay unique within each variant.
          for (const v of variants) {
            let n = 0;
            v.sections = v.sections.map((s, si) => ({
              ...s,
              id: `sec-${si}`,
              items: s.items.map((i) => ({ ...i, id: `item-${n++}` })),
            }));
          }
          return {
            bank,
            variants,
            currentVariantId: variants[0].id,
            targetId,
            refCount: placements.length,
          };
        });
    })
  );
}
