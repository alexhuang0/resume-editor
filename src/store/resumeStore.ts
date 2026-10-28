import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BankItem,
  Bullet,
  HeaderField,
  Item,
  Resume,
  Section,
  SectionKind,
} from "./schema";
import { newId } from "./schema";
import { migratePersistedLibrary } from "./migrations";
import { findRawItem } from "./findRawItem";
import { reorderByIds } from "./reorderByIds";
import { bankEntryFromItem } from "./bankFromItem";
import { bankItemDisplayLabel } from "./bankLabel";
import { bakeOverlay, isOrphaned, linkState, resolveResume } from "./resolve";
import { projectItemsToImport } from "./importProjection";
import { makeSeedResume } from "./seed";
import { useUiStore } from "./uiStore";

const STORAGE_KEY = "resume-editor:v1";

/**
 * Item keys that carry wording (design §4.4). An `updateItem` patch touching
 * any of them is a wording edit and auto-detaches a linked item first; patches
 * limited to other keys (hidden, link, hiddenBulletIds, bulletOrder...) never do.
 */
const ITEM_WORDING_KEYS: ReadonlySet<string> = new Set([
  "heading",
  "subheading",
  "location",
  "dateRange",
  "bullets",
]);

type LibraryState = {
  variants: Resume[];
  currentVariantId: string;
  bank: BankItem[];
};

/** Fields `updateBankItem` may change; id, kind and bullets have dedicated paths. */
export type BankItemPatch = Partial<
  Pick<BankItem, "heading" | "subheading" | "location" | "dateRange" | "label">
>;

type Actions = {
  // Variant lifecycle
  setCurrentVariant: (id: string) => void;
  createVariant: (name?: string) => string;
  duplicateVariant: (id: string) => string;
  renameVariant: (id: string, name: string) => void;
  deleteVariant: (id: string) => void;
  replaceVariant: (id: string, resume: Resume) => void;
  addVariant: (resume: Resume) => string;
  replaceLibrary: (variants: Resume[], bank: BankItem[]) => void;

  // Header
  updateHeader: (patch: { fullName?: string }) => void;
  addHeaderField: (afterId?: string) => string;
  deleteHeaderField: (id: string) => HeaderField | null;
  insertHeaderField: (field: HeaderField, atIndex: number) => void;
  updateHeaderField: (id: string, patch: Partial<HeaderField>) => void;
  duplicateHeaderField: (id: string) => string | null;
  toggleHeaderFieldHidden: (id: string) => void;
  reorderHeaderFields: (orderedIds: string[]) => void;

  // Bank items (never touch variants)
  addBankItem: (kind: SectionKind) => string;
  updateBankItem: (id: string, patch: BankItemPatch) => void;
  /**
   * Removes the entry and orphans every referencing item in EVERY variant
   * (linked and detached alike) into a local item with its content intact and
   * `link` dropped (design §4.3, Req 7.7). Never gated on a reference count.
   * Pushes an undo toast that re-inserts the entry at its old index and
   * restores the raw items. Returns the removed entry, or null if unknown.
   */
  deleteBankItem: (id: string) => BankItem | null;
  duplicateBankItem: (id: string) => string | null;
  renameBankItemLabel: (id: string, label: string) => void;

  // Bank bullets
  addBankBullet: (bankId: string, afterId?: string) => string | null;
  updateBankBullet: (bankId: string, bulletId: string, text: string) => void;
  deleteBankBullet: (bankId: string, bulletId: string) => Bullet | null;
  reorderBankBullets: (bankId: string, orderedIds: string[]) => void;

  // Font
  setFont: (font: Resume["font"]) => void;

  // Sections
  addSection: (kind: SectionKind, afterId?: string) => string;
  deleteSection: (id: string) => Section | null;
  duplicateSection: (id: string) => string | null;
  renameSection: (id: string, title: string) => void;
  toggleSectionHidden: (id: string) => void;
  reorderSections: (orderedIds: string[]) => void;
  insertSection: (section: Section, atIndex: number) => void;

  // Items
  addItem: (sectionId: string, afterId?: string) => string | null;
  addItemFromBank: (
    sectionId: string,
    bankId: string,
    afterId?: string
  ) => string | null;
  deleteItem: (sectionId: string, itemId: string) => Item | null;
  duplicateItem: (sectionId: string, itemId: string) => string | null;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Item>) => void;
  toggleItemHidden: (sectionId: string, itemId: string) => void;
  reorderItems: (sectionId: string, orderedIds: string[]) => void;
  insertItem: (sectionId: string, item: Item, atIndex: number) => void;
  /**
   * Explicit detach (design §4.3): writes the bank content locally, bakes the
   * visibility overlay into the bullets and sets `link.detached`. No-op unless
   * the raw item is linked and its bank entry exists. Never touches the bank.
   */
  detachItem: (sectionId: string, itemId: string) => void;
  /**
   * Hard-overwrite resync (design §4.3, Req 7.4): clears the local content
   * fields and bullets and drops `detached`, so the item resolves from the bank
   * again. Baked `hidden` flags are NOT turned back into `hiddenBulletIds`:
   * bullet-level visibility and order are discarded with the local wording.
   * Pushes a toast whose undo restores the full pre-resync raw item. No-op
   * unless the raw item is detached and its bank entry exists. Never touches
   * the bank.
   */
  resyncItem: (sectionId: string, itemId: string) => void;
  /**
   * Push-local-to-bank (design §4.3, §5.7, Req 7.5): copies the detached
   * item's wording into its bank entry (bumping `updatedAt`), then clears the
   * local content and drops `detached`, so the item is linked again. Writes
   * unconditionally; callers should confirm first when
   * `pushWarnsHiddenBullets(item)`, because baked `hidden` flags become
   * bank-level and park those bullets in every variant linked to the entry.
   * Pushes a toast whose undo restores the previous bank entry and raw item.
   * No-op (returns false) unless the raw item is detached and its bank entry
   * exists. Returns true when it pushed.
   */
  pushItemToBank: (sectionId: string, itemId: string) => boolean;
  /**
   * Add-to-bank (design §4.3, Req 5.4, 7.5): creates a bank entry from a LOCAL
   * item (kind from its section, bullet ids and `hidden` flags preserved, so a
   * local item's hidden bullets become bank-level hidden flags, as in push),
   * then relinks the item and clears its local content and bullets: a linked
   * item stores no wording. The rendered output is unchanged. Returns the new
   * bank id, or null (no-op) unless the RAW item is local. Pushes an "Added to
   * bank" toast whose undo restores the raw item and removes the entry unless
   * something still references it.
   */
  promoteItemToBank: (sectionId: string, itemId: string) => string | null;
  /**
   * Fork (design §4.3 Detached --> Linked, §4.4, Req 7.5): creates a NEW bank
   * entry from the item's current resolved content, relinks the item to it and
   * clears its local content, bullets and `detached`. The original entry is
   * untouched (same object). Acts on a detached item (its own wording; the
   * original entry may be gone) or a linked item whose entry exists (the
   * entry's wording with the item's overlay baked in, so hidden bullets stay
   * hidden and order is kept as bank-level flags/order) or an ORPHANED linked
   * item (entry gone): that forks the item's OWN fields, which are empty for a
   * store-maintained linked item but hold any wording typed while orphaned.
   * Returns the new bank id, or null (no-op) for local items and missing
   * items. The fork gets no label unless the original entry has one,
   * in which case it is "<label> (fork)". Pushes a "Forked to a new bank
   * entry" toast whose undo restores the raw item and removes the new entry
   * unless something still references it.
   */
  forkItemToNewBankItem: (sectionId: string, itemId: string) => string | null;
  /**
   * Guided bank bootstrap (design §4.3, Req 11.1, 11.2): bulk `promoteItemToBank`
   * over the selected sections of `variantId`. For every item in those sections
   * that is NOT already linked (i.e. has no `link` — this skips both linked and
   * detached items, exactly as `promoteItemToBank` would), creates a bank entry
   * from its content, relinks the item to that entry, and CLEARS the item's
   * local wording (content fields, bullets and overlay keys), identical to
   * `promoteItemToBank`. All creations and relinks apply in ONE store update and
   * the targeted variant's `updatedAt` is bumped once. Returns the ids of the
   * bank entries created, in encounter order (empty when nothing qualified).
   *
   * Safe to re-run: a second call over the same sections creates nothing,
   * because every item is now linked. No-op (returns `[]`) when the variant or
   * every section is absent, or no section holds a local item. Never pushes a
   * toast; the importer UI (10.3) owns user feedback.
   */
  importItemsToBank: (variantId: string, sectionIds: string[]) => string[];
  /**
   * Drop-link (design §4.2 orphan safety net, Req 6.3): turns an ORPHANED item
   * (has a link, bank entry missing; linked or detached) into a LOCAL item.
   * `link`, `hiddenBulletIds` and `bulletOrder` are omitted; content and
   * bullets are kept as they are. Pushes a "Link dropped" toast whose undo
   * restores the exact raw item by id (no-op if gone). No-op, no toast, for
   * local items and for items whose entry still exists (use Detach there).
   */
  dropItemLink: (sectionId: string, itemId: string) => void;

  // Bullets
  addBullet: (
    sectionId: string,
    itemId: string,
    afterId?: string
  ) => string | null;
  deleteBullet: (
    sectionId: string,
    itemId: string,
    bulletId: string
  ) => Bullet | null;
  duplicateBullet: (
    sectionId: string,
    itemId: string,
    bulletId: string
  ) => string | null;
  updateBullet: (
    sectionId: string,
    itemId: string,
    bulletId: string,
    text: string
  ) => void;
  toggleBulletHidden: (
    sectionId: string,
    itemId: string,
    bulletId: string
  ) => void;
  reorderBullets: (
    sectionId: string,
    itemId: string,
    orderedIds: string[]
  ) => void;
  insertBullet: (
    sectionId: string,
    itemId: string,
    bullet: Bullet,
    atIndex: number
  ) => void;
};

export type ResumeStore = LibraryState & Actions;

const defaultSeed = makeSeedResume("Default");

function bumpUpdatedAt(r: Resume): Resume {
  return { ...r, updatedAt: new Date().toISOString() };
}

function defaultSectionTitle(kind: SectionKind): string {
  switch (kind) {
    case "education":
      return "Education";
    case "experience":
      return "Experience";
    case "projects":
      return "Projects";
    case "skills":
      return "Technical Skills";
    case "custom":
      return "New Section";
  }
}

function blankItem(): Item {
  return {
    id: newId("i"),
    heading: "",
    subheading: "",
    location: "",
    dateRange: "",
    bullets: [{ id: newId("b"), text: "" }],
  };
}

/**
 * The raw shape of an item linked (not detached) to `bankId`: keeps id, hidden
 * and anything else item-level; content and overlay keys are omitted (not
 * blanked); bullets cleared. Shared by promote and fork.
 */
function relinkedItem(snapshot: Item, bankId: string): Item {
  const {
    heading: _h,
    subheading: _s,
    location: _l,
    dateRange: _d,
    hiddenBulletIds: _hb,
    bulletOrder: _bo,
    ...rest
  } = snapshot;
  return { ...rest, link: { bankId }, bullets: [] };
}

function blankBullet(): Bullet {
  return { id: newId("b"), text: "" };
}

function cloneItem(item: Item): Item {
  return {
    ...item,
    id: newId("i"),
    bullets: item.bullets.map((b) => ({ ...b, id: newId("b") })),
  };
}

function blankBankItem(kind: SectionKind): BankItem {
  return {
    id: newId("bk"),
    kind,
    heading: "",
    subheading: "",
    location: "",
    dateRange: "",
    bullets: [blankBullet()],
    updatedAt: new Date().toISOString(),
  };
}

function cloneBankItem(item: BankItem): BankItem {
  return {
    ...item,
    id: newId("bk"),
    label: item.label ? `${item.label} copy` : item.label,
    bullets: item.bullets.map((b) => ({ ...b, id: newId("b") })),
    updatedAt: new Date().toISOString(),
  };
}

function cloneSection(section: Section): Section {
  return {
    ...section,
    id: newId("s"),
    items: section.items.map((it) => cloneItem(it)),
  };
}

export const useResumeStore = create<ResumeStore>()(
  persist(
    (set, get) => {
      const updateCurrent = (mut: (r: Resume) => Resume) =>
        set((state) => ({
          variants: state.variants.map((v) =>
            v.id === state.currentVariantId ? bumpUpdatedAt(mut(v)) : v
          ),
        }));

      const insertAfter = <T extends { id: string }>(
        arr: T[],
        afterId: string | undefined,
        item: T
      ): T[] => {
        if (!afterId) return [...arr, item];
        const idx = arr.findIndex((x) => x.id === afterId);
        if (idx === -1) return [...arr, item];
        return [...arr.slice(0, idx + 1), item, ...arr.slice(idx + 1)];
      };

      // The one place the auto-detach rule lives (design §4.4, Req 7.1). Applies
      // `edit` to the raw item in the current variant. For a wording edit on a
      // LINKED item whose bank entry exists, the item is first detached (overlay
      // baked via `bakeOverlay`, same as `detachItem`) and `edit` is applied to
      // that now-local item, all in ONE `set`: no render ever sees a
      // detached-but-unedited item. Local and detached items just take the edit.
      // A linked item whose entry is missing (orphaned) is NOT detached, since
      // there is nothing to bake: the edit lands on it as-is so typing is not
      // silently dropped, and the orphan affordance (7.9) resolves it.
      // `isWordingEdit = false` skips detaching. Returns false when the item or
      // section does not exist in the current variant (nothing written).
      const withAutoDetach = (
        sectionId: string,
        itemId: string,
        edit: (item: Item) => Item,
        isWordingEdit = true
      ): boolean => {
        const state = get();
        const variant =
          state.variants.find((v) => v.id === state.currentVariantId) ??
          state.variants[0];
        const raw = findRawItem(variant, sectionId, itemId);
        if (!raw) return false;
        let base = raw;
        if (isWordingEdit && raw.link && linkState(raw) === "linked") {
          const entry = state.bank.find((b) => b.id === raw.link!.bankId);
          if (entry) base = bakeOverlay(raw, entry);
        }
        const edited = edit(base);
        updateCurrent((r) => ({
          ...r,
          sections: r.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  items: s.items.map((i) => (i.id === itemId ? edited : i)),
                }
              : s
          ),
        }));
        return true;
      };

      // Applies `mut` to one bank item and bumps its updatedAt. Leaves
      // `variants` alone: bank edits never write through to variants here.
      const updateBank = (id: string, mut: (b: BankItem) => BankItem) =>
        set((state) => ({
          bank: state.bank.map((b) =>
            b.id === id ? { ...mut(b), updatedAt: new Date().toISOString() } : b
          ),
        }));

      // Shared tail of promote and fork: append the new `entry`, swap the raw
      // `snapshot` in the current variant for an item linked to it, and push a
      // toast. Undo is pure restoration: swap the raw snapshot back in, then
      // drop the new entry only if nothing in any variant references it.
      // No-op if the item is gone.
      const relinkToNewEntry = (
        variantId: string,
        sectionId: string,
        snapshot: Item,
        entry: BankItem,
        message: string
      ): string => {
        const itemId = snapshot.id;
        const bankId = entry.id;
        set((st) => ({ bank: [...st.bank, entry] }));
        updateCurrent((r) => ({
          ...r,
          sections: r.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  items: s.items.map((i) =>
                    i.id === itemId ? relinkedItem(snapshot, bankId) : i
                  ),
                }
              : s
          ),
        }));

        useUiStore.getState().pushToast({
          message,
          undo: () =>
            set((st) => {
              const target = st.variants.find((v) => v.id === variantId);
              if (
                !target?.sections.some((s) =>
                  s.items.some((i) => i.id === itemId)
                )
              ) {
                return st;
              }
              const variants = st.variants.map((v) =>
                v.id === variantId
                  ? bumpUpdatedAt({
                      ...v,
                      sections: v.sections.map((s) =>
                        s.items.some((i) => i.id === itemId)
                          ? {
                              ...s,
                              items: s.items.map((i) =>
                                i.id === itemId ? snapshot : i
                              ),
                            }
                          : s
                      ),
                    })
                  : v
              );
              const stillReferenced = variants.some((v) =>
                v.sections.some((s) =>
                  s.items.some((i) => i.link?.bankId === bankId)
                )
              );
              return {
                variants,
                bank: stillReferenced
                  ? st.bank
                  : st.bank.filter((b) => b.id !== bankId),
              };
            }),
        });
        return bankId;
      };

      return {
        variants: [defaultSeed],
        currentVariantId: defaultSeed.id,
        bank: [],

        setCurrentVariant: (id) => set({ currentVariantId: id }),

        createVariant: (name = "Untitled") => {
          const r = makeSeedResume(name);
          set((s) => ({
            variants: [...s.variants, r],
            currentVariantId: r.id,
          }));
          return r.id;
        },

        duplicateVariant: (id) => {
          const source = get().variants.find((v) => v.id === id);
          if (!source) return "";
          const copy: Resume = {
            ...source,
            id: newId("r"),
            name: `${source.name} copy`,
            updatedAt: new Date().toISOString(),
            sections: source.sections.map((s) => cloneSection(s)),
          };
          set((s) => ({
            variants: [...s.variants, copy],
            currentVariantId: copy.id,
          }));
          return copy.id;
        },

        renameVariant: (id, name) =>
          set((s) => ({
            variants: s.variants.map((v) =>
              v.id === id ? { ...v, name, updatedAt: new Date().toISOString() } : v
            ),
          })),

        deleteVariant: (id) => {
          const state = get();
          if (state.variants.length === 1) return;
          const remaining = state.variants.filter((v) => v.id !== id);
          const nextCurrent =
            state.currentVariantId === id
              ? remaining[0].id
              : state.currentVariantId;
          set({ variants: remaining, currentVariantId: nextCurrent });
        },

        replaceVariant: (id, resume) =>
          set((s) => ({
            variants: s.variants.map((v) =>
              v.id === id ? { ...resume, id, updatedAt: new Date().toISOString() } : v
            ),
          })),

        addVariant: (resume) => {
          const r: Resume = { ...resume, id: newId("r") };
          set((s) => ({
            variants: [...s.variants, r],
            currentVariantId: r.id,
          }));
          return r.id;
        },

        replaceLibrary: (variants, bank) => {
          if (variants.length === 0) return;
          set({ variants, bank, currentVariantId: variants[0].id });
        },

        updateHeader: (patch) =>
          updateCurrent((r) => ({ ...r, header: { ...r.header, ...patch } })),

        addHeaderField: (afterId) => {
          const field: HeaderField = { id: newId("hf"), label: "" };
          updateCurrent((r) => ({
            ...r,
            header: { ...r.header, fields: insertAfter(r.header.fields, afterId, field) },
          }));
          return field.id;
        },

        deleteHeaderField: (id) => {
          let removed: HeaderField | null = null;
          updateCurrent((r) => {
            removed = r.header.fields.find((f) => f.id === id) ?? null;
            return {
              ...r,
              header: { ...r.header, fields: r.header.fields.filter((f) => f.id !== id) },
            };
          });
          return removed;
        },

        insertHeaderField: (field, atIndex) =>
          updateCurrent((r) => {
            const fields = [...r.header.fields];
            fields.splice(Math.max(0, Math.min(atIndex, fields.length)), 0, field);
            return { ...r, header: { ...r.header, fields } };
          }),

        updateHeaderField: (id, patch) =>
          updateCurrent((r) => ({
            ...r,
            header: {
              ...r.header,
              fields: r.header.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
            },
          })),

        duplicateHeaderField: (id) => {
          let newId_: string | null = null;
          updateCurrent((r) => {
            const idx = r.header.fields.findIndex((f) => f.id === id);
            if (idx === -1) return r;
            const copy: HeaderField = { ...r.header.fields[idx], id: newId("hf") };
            newId_ = copy.id;
            const fields = [...r.header.fields];
            fields.splice(idx + 1, 0, copy);
            return { ...r, header: { ...r.header, fields } };
          });
          return newId_;
        },

        toggleHeaderFieldHidden: (id) =>
          updateCurrent((r) => ({
            ...r,
            header: {
              ...r.header,
              fields: r.header.fields.map((f) =>
                f.id === id ? { ...f, hidden: !f.hidden } : f
              ),
            },
          })),

        reorderHeaderFields: (orderedIds) =>
          updateCurrent((r) => ({
            ...r,
            header: { ...r.header, fields: reorderByIds(r.header.fields, orderedIds) },
          })),

        addBankItem: (kind) => {
          const item = blankBankItem(kind);
          set((s) => ({ bank: [...s.bank, item] }));
          return item.id;
        },

        updateBankItem: (id, patch) =>
          updateBank(id, (b) => ({ ...b, ...patch })),

        // Orphan-on-delete (design §4.3, §4.4, Req 7.7). Every item in every
        // variant that references the entry, linked or detached, becomes a
        // LOCAL item (`link` omitted). Linked items keep their rendered output:
        // the entry's wording with the overlay baked in. Never gated on a
        // reference count; an unreferenced entry just has nothing to rewrite.
        deleteBankItem: (id) => {
          const state = get();
          const index = state.bank.findIndex((b) => b.id === id);
          if (index === -1) return null;
          const entry = state.bank[index];

          // (variantId, itemId, raw pre-delete snapshot) for every touched item.
          const touched: { variantId: string; itemId: string; snapshot: Item }[] =
            [];
          const variants = state.variants.map((v) => {
            let variantChanged = false;
            const sections = v.sections.map((section) => {
              let sectionChanged = false;
              const items = section.items.map((item) => {
                if (item.link?.bankId !== id) return item;
                sectionChanged = true;
                touched.push({ variantId: v.id, itemId: item.id, snapshot: item });
                if (linkState(item) === "linked") {
                  const { link: _link, ...local } = bakeOverlay(item, entry);
                  return local;
                }
                const { link: _link, ...local } = item;
                return local;
              });
              if (!sectionChanged) return section;
              variantChanged = true;
              return { ...section, items };
            });
            return variantChanged ? bumpUpdatedAt({ ...v, sections }) : v;
          });

          set({
            bank: state.bank.filter((b) => b.id !== id),
            ...(touched.length > 0 ? { variants } : {}),
          });

          const label = bankItemDisplayLabel(entry);
          const n = touched.length;
          useUiStore.getState().pushToast({
            message:
              n === 0
                ? `Bank entry "${label}" deleted`
                : `Bank entry "${label}" deleted — ${n} ${
                    n === 1 ? "item" : "items"
                  } kept as local copies`,
            // Pure state restoration. Re-insert the entry at its old index and
            // swap each raw snapshot back in by id (any section, in case the
            // item moved). Items that no longer exist are skipped. No-op if the
            // entry id is back in the bank already.
            undo: () =>
              set((st) => {
                if (st.bank.some((b) => b.id === id)) return st;
                const at = Math.max(0, Math.min(index, st.bank.length));
                const bank = [...st.bank.slice(0, at), entry, ...st.bank.slice(at)];

                const byVariant = new Map<string, Map<string, Item>>();
                for (const t of touched) {
                  const m = byVariant.get(t.variantId) ?? new Map<string, Item>();
                  m.set(t.itemId, t.snapshot);
                  byVariant.set(t.variantId, m);
                }
                const restored = st.variants.map((v) => {
                  const snaps = byVariant.get(v.id);
                  if (!snaps) return v;
                  let variantChanged = false;
                  const sections = v.sections.map((section) => {
                    if (!section.items.some((i) => snaps.has(i.id))) return section;
                    variantChanged = true;
                    return {
                      ...section,
                      items: section.items.map((i) => snaps.get(i.id) ?? i),
                    };
                  });
                  return variantChanged ? bumpUpdatedAt({ ...v, sections }) : v;
                });
                return { bank, variants: restored };
              }),
          });
          return entry;
        },

        duplicateBankItem: (id) => {
          const source = get().bank.find((b) => b.id === id);
          if (!source) return null;
          const copy = cloneBankItem(source);
          set((s) => {
            const idx = s.bank.findIndex((b) => b.id === id);
            return {
              bank: [...s.bank.slice(0, idx + 1), copy, ...s.bank.slice(idx + 1)],
            };
          });
          return copy.id;
        },

        // An empty or whitespace-only label clears it, so list display falls
        // back to the heading (then "Untitled <kind>").
        renameBankItemLabel: (id, label) =>
          updateBank(id, (b) => ({ ...b, label: label.trim() ? label : undefined })),

        addBankBullet: (bankId, afterId) => {
          if (!get().bank.some((b) => b.id === bankId)) return null;
          const bullet = blankBullet();
          updateBank(bankId, (b) => ({
            ...b,
            bullets: insertAfter(b.bullets, afterId, bullet),
          }));
          return bullet.id;
        },

        updateBankBullet: (bankId, bulletId, text) =>
          updateBank(bankId, (b) => ({
            ...b,
            bullets: b.bullets.map((x) => (x.id === bulletId ? { ...x, text } : x)),
          })),

        deleteBankBullet: (bankId, bulletId) => {
          const removed =
            get()
              .bank.find((b) => b.id === bankId)
              ?.bullets.find((x) => x.id === bulletId) ?? null;
          if (!removed) return null;
          updateBank(bankId, (b) => ({
            ...b,
            bullets: b.bullets.filter((x) => x.id !== bulletId),
          }));
          return removed;
        },

        reorderBankBullets: (bankId, orderedIds) =>
          updateBank(bankId, (b) => ({
            ...b,
            bullets: reorderByIds(b.bullets, orderedIds),
          })),

        setFont: (font) => updateCurrent((r) => ({ ...r, font })),

        addSection: (kind, afterId) => {
          const newSection: Section = {
            id: newId("s"),
            kind,
            title: defaultSectionTitle(kind),
            items: [blankItem()],
          };
          updateCurrent((r) => ({
            ...r,
            sections: insertAfter(r.sections, afterId, newSection),
          }));
          return newSection.id;
        },

        deleteSection: (id) => {
          let removed: Section | null = null;
          updateCurrent((r) => {
            removed = r.sections.find((s) => s.id === id) ?? null;
            return { ...r, sections: r.sections.filter((s) => s.id !== id) };
          });
          return removed;
        },

        duplicateSection: (id) => {
          let newSecId: string | null = null;
          updateCurrent((r) => {
            const idx = r.sections.findIndex((s) => s.id === id);
            if (idx === -1) return r;
            const copy = cloneSection(r.sections[idx]);
            copy.title = `${copy.title} copy`;
            newSecId = copy.id;
            return {
              ...r,
              sections: [
                ...r.sections.slice(0, idx + 1),
                copy,
                ...r.sections.slice(idx + 1),
              ],
            };
          });
          return newSecId;
        },

        renameSection: (id, title) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) => (s.id === id ? { ...s, title } : s)),
          })),

        toggleSectionHidden: (id) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === id ? { ...s, hidden: !s.hidden } : s
            ),
          })),

        reorderSections: (orderedIds) =>
          updateCurrent((r) => ({
            ...r,
            sections: reorderByIds(r.sections, orderedIds),
          })),

        insertSection: (section, atIndex) =>
          updateCurrent((r) => {
            const sections = [...r.sections];
            const i = Math.max(0, Math.min(atIndex, sections.length));
            sections.splice(i, 0, section);
            return { ...r, sections };
          }),

        addItem: (sectionId, afterId) => {
          const item = blankItem();
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? { ...s, items: insertAfter(s.items, afterId, item) }
                : s
            ),
          }));
          return item.id;
        },

        // Inserts a linked item into the CURRENT variant (Req 5.4, 6.1). The
        // item stores no wording: the resolver reads it from the bank. Never
        // touches the bank. Kind is not enforced; the picker filters by kind.
        addItemFromBank: (sectionId, bankId, afterId) => {
          const state = get();
          if (!state.bank.some((b) => b.id === bankId)) return null;
          const current =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          if (!current?.sections.some((s) => s.id === sectionId)) return null;

          const item: Item = { id: newId("i"), link: { bankId }, bullets: [] };
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? { ...s, items: insertAfter(s.items, afterId, item) }
                : s
            ),
          }));
          return item.id;
        },

        deleteItem: (sectionId, itemId) => {
          let removed: Item | null = null;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) => {
              if (s.id !== sectionId) return s;
              removed = s.items.find((i) => i.id === itemId) ?? null;
              return { ...s, items: s.items.filter((i) => i.id !== itemId) };
            }),
          }));
          return removed;
        },

        duplicateItem: (sectionId, itemId) => {
          let newItemId: string | null = null;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) => {
              if (s.id !== sectionId) return s;
              const idx = s.items.findIndex((i) => i.id === itemId);
              if (idx === -1) return s;
              const copy = cloneItem(s.items[idx]);
              newItemId = copy.id;
              return {
                ...s,
                items: [
                  ...s.items.slice(0, idx + 1),
                  copy,
                  ...s.items.slice(idx + 1),
                ],
              };
            }),
          }));
          return newItemId;
        },

        updateItem: (sectionId, itemId, patch) =>
          withAutoDetach(
            sectionId,
            itemId,
            (i) => ({ ...i, ...patch }),
            Object.keys(patch).some((k) => ITEM_WORDING_KEYS.has(k))
          ),

        detachItem: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const raw = findRawItem(variant, sectionId, itemId);
          if (!raw?.link || linkState(raw) !== "linked") return;
          const entry = state.bank.find((b) => b.id === raw.link!.bankId);
          if (!entry) return; // orphaned: handled by 7.9
          const baked = bakeOverlay(raw, entry);
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => (i.id === itemId ? baked : i)),
                  }
                : s
            ),
          }));
        },

        resyncItem: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const snapshot = findRawItem(variant, sectionId, itemId);
          if (!snapshot?.link || linkState(snapshot) !== "detached") return;
          const bankId = snapshot.link.bankId;
          if (!state.bank.some((b) => b.id === bankId)) return; // orphan

          // Drop every content and overlay key (omitted, not blanked) and the
          // `detached` flag; keep id, hidden and anything else item-level.
          const {
            heading: _h,
            subheading: _s,
            location: _l,
            dateRange: _d,
            hiddenBulletIds: _hb,
            bulletOrder: _bo,
            ...rest
          } = snapshot;
          const resynced: Item = { ...rest, link: { bankId }, bullets: [] };

          const variantId = variant.id;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => (i.id === itemId ? resynced : i)),
                  }
                : s
            ),
          }));

          useUiStore.getState().pushToast({
            message:
              "Resynced from bank — local wording and hidden bullets replaced",
            // Pure state restoration: swap the snapshot back in by id, wherever
            // the item lives in that variant now. No-op if it is gone.
            undo: () =>
              set((st) => {
                const target = st.variants.find((v) => v.id === variantId);
                if (
                  !target?.sections.some((s) =>
                    s.items.some((i) => i.id === itemId)
                  )
                ) {
                  return st;
                }
                return {
                  variants: st.variants.map((v) =>
                    v.id === variantId
                      ? bumpUpdatedAt({
                          ...v,
                          sections: v.sections.map((s) =>
                            s.items.some((i) => i.id === itemId)
                              ? {
                                  ...s,
                                  items: s.items.map((i) =>
                                    i.id === itemId ? snapshot : i
                                  ),
                                }
                              : s
                          ),
                        })
                      : v
                  ),
                };
              }),
          });
        },

        pushItemToBank: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const snapshot = findRawItem(variant, sectionId, itemId);
          if (!snapshot?.link || linkState(snapshot) !== "detached") return false;
          const bankId = snapshot.link.bankId;
          const prevEntry = state.bank.find((b) => b.id === bankId);
          if (!prevEntry) return false; // orphan

          // Bank gets the local wording verbatim. The bullets keep their ids and
          // their `hidden` flags as written: those flags were baked from this
          // variant's overlay at detach time, and from here on they are
          // BANK-LEVEL, i.e. hidden in every variant linked to the entry (§5.7).
          // `kind`, `id` and `label` are left alone.
          updateBank(bankId, (b) => ({
            ...b,
            heading: snapshot.heading,
            subheading: snapshot.subheading,
            location: snapshot.location,
            dateRange: snapshot.dateRange,
            bullets: snapshot.bullets.map((x) => ({ ...x })),
          }));

          // Item side: same shape as resync (content keys omitted, linked).
          const {
            heading: _h,
            subheading: _s,
            location: _l,
            dateRange: _d,
            hiddenBulletIds: _hb,
            bulletOrder: _bo,
            ...rest
          } = snapshot;
          const pushed: Item = { ...rest, link: { bankId }, bullets: [] };

          const variantId = variant.id;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => (i.id === itemId ? pushed : i)),
                  }
                : s
            ),
          }));

          useUiStore.getState().pushToast({
            message: "Pushed local wording to the bank",
            // Pure restoration of both halves. No-op if either the entry or
            // the item is gone (e.g. entry deleted, item removed since).
            undo: () =>
              set((st) => {
                const target = st.variants.find((v) => v.id === variantId);
                if (
                  !st.bank.some((b) => b.id === bankId) ||
                  !target?.sections.some((s) =>
                    s.items.some((i) => i.id === itemId)
                  )
                ) {
                  return st;
                }
                return {
                  bank: st.bank.map((b) => (b.id === bankId ? prevEntry : b)),
                  variants: st.variants.map((v) =>
                    v.id === variantId
                      ? bumpUpdatedAt({
                          ...v,
                          sections: v.sections.map((s) =>
                            s.items.some((i) => i.id === itemId)
                              ? {
                                  ...s,
                                  items: s.items.map((i) =>
                                    i.id === itemId ? snapshot : i
                                  ),
                                }
                              : s
                          ),
                        })
                      : v
                  ),
                };
              }),
          });
          return true;
        },

        promoteItemToBank: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const section = variant?.sections.find((s) => s.id === sectionId);
          const snapshot = findRawItem(variant, sectionId, itemId);
          if (!section || !snapshot || linkState(snapshot) !== "local") {
            return null;
          }

          const entry = bankEntryFromItem(snapshot, section.kind);
          return relinkToNewEntry(
            variant.id,
            sectionId,
            snapshot,
            entry,
            "Added to bank"
          );
        },

        forkItemToNewBankItem: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const section = variant?.sections.find((s) => s.id === sectionId);
          const snapshot = findRawItem(variant, sectionId, itemId);
          if (!section || !snapshot) return null;

          const ls = linkState(snapshot);
          let source: Item;
          let original: BankItem | undefined;
          if (ls === "detached") {
            // Own wording is the resolved content; the entry may be gone.
            source = snapshot;
            original = state.bank.find((b) => b.id === snapshot.link!.bankId);
          } else if (ls === "linked") {
            original = state.bank.find((b) => b.id === snapshot.link!.bankId);
            // Orphaned (entry gone): fork the item's OWN fields. They are empty
            // for a store-maintained linked item but may hold wording typed
            // while orphaned (withAutoDetach applies those edits locally).
            // Otherwise bake the overlay so hidden bullets stay hidden and
            // order is kept.
            source = original ? bakeOverlay(snapshot, original) : snapshot;
          } else {
            return null; // local: promote is the right action
          }

          const entry = bankEntryFromItem(source, section.kind);
          if (original?.label) entry.label = `${original.label} (fork)`;
          return relinkToNewEntry(
            variant.id,
            sectionId,
            snapshot,
            entry,
            "Forked to a new bank entry"
          );
        },

        // Bulk promote (design §4.3, Req 11.1, 11.2). The set of items to
        // promote is decided by the pure `projectItemsToImport` — the SAME
        // projection the importer preview (10.3) renders — so preview and apply
        // can never disagree about WHICH items qualify. For each projected
        // entry this does exactly what `promoteItemToBank` does: build a bank
        // entry with `bankEntryFromItem` (kind from the item's section) and
        // relink the raw item with `relinkedItem`, which clears the content,
        // bullets and overlay keys. Items the projection skips (anything with a
        // `link`, linked OR detached) are left untouched, so a second run finds
        // only linked items and projects nothing, creating nothing (Property
        // 17). Everything lands in ONE `set`, with the variant's `updatedAt`
        // bumped once.
        importItemsToBank: (variantId, sectionIds) => {
          const state = get();
          const variant = state.variants.find((v) => v.id === variantId);
          if (!variant) return [];

          const projection = projectItemsToImport(variant, sectionIds);
          if (projection.length === 0) return [];

          // Which (section,item) pairs the projection selected, so the walk
          // below promotes exactly that set and nothing re-derives "qualifies".
          const toPromote = new Set(projection.map((p) => `${p.sectionId}\u0000${p.itemId}`));
          const createdIds: string[] = [];
          const newEntries: BankItem[] = [];

          const sections = variant.sections.map((section) => {
            let sectionChanged = false;
            const items = section.items.map((item) => {
              if (!toPromote.has(`${section.id}\u0000${item.id}`)) return item;
              const entry = bankEntryFromItem(item, section.kind);
              newEntries.push(entry);
              createdIds.push(entry.id);
              sectionChanged = true;
              return relinkedItem(item, entry.id);
            });
            return sectionChanged ? { ...section, items } : section;
          });

          set((st) => ({
            bank: [...st.bank, ...newEntries],
            variants: st.variants.map((v) =>
              v.id === variantId ? bumpUpdatedAt({ ...v, sections }) : v
            ),
          }));
          return createdIds;
        },

        dropItemLink: (sectionId, itemId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const snapshot = findRawItem(variant, sectionId, itemId);
          if (!snapshot || !isOrphaned(snapshot, state.bank)) return;

          // Content and bullets stay as they are; link and overlay keys go.
          const {
            link: _link,
            hiddenBulletIds: _hb,
            bulletOrder: _bo,
            ...local
          } = snapshot;

          const variantId = variant.id;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? { ...s, items: s.items.map((i) => (i.id === itemId ? local : i)) }
                : s
            ),
          }));

          useUiStore.getState().pushToast({
            message: "Link dropped",
            // Pure restoration: swap the raw snapshot back in by id, wherever
            // the item lives in that variant now. No-op if it is gone.
            undo: () =>
              set((st) => {
                const target = st.variants.find((v) => v.id === variantId);
                if (
                  !target?.sections.some((s) =>
                    s.items.some((i) => i.id === itemId)
                  )
                ) {
                  return st;
                }
                return {
                  variants: st.variants.map((v) =>
                    v.id === variantId
                      ? bumpUpdatedAt({
                          ...v,
                          sections: v.sections.map((s) =>
                            s.items.some((i) => i.id === itemId)
                              ? {
                                  ...s,
                                  items: s.items.map((i) =>
                                    i.id === itemId ? snapshot : i
                                  ),
                                }
                              : s
                          ),
                        })
                      : v
                  ),
                };
              }),
          });
        },

        toggleItemHidden: (sectionId, itemId) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) =>
                      i.id === itemId ? { ...i, hidden: !i.hidden } : i
                    ),
                  }
                : s
            ),
          })),

        reorderItems: (sectionId, orderedIds) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? { ...s, items: reorderByIds(s.items, orderedIds) }
                : s
            ),
          })),

        insertItem: (sectionId, item, atIndex) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) => {
              if (s.id !== sectionId) return s;
              const items = [...s.items];
              const i = Math.max(0, Math.min(atIndex, items.length));
              items.splice(i, 0, item);
              return { ...s, items };
            }),
          })),

        addBullet: (sectionId, itemId, afterId) => {
          const bullet = blankBullet();
          const found = withAutoDetach(sectionId, itemId, (i) => ({
            ...i,
            bullets: insertAfter(i.bullets, afterId, bullet),
          }));
          return found ? bullet.id : null;
        },

        deleteBullet: (sectionId, itemId, bulletId) => {
          let removed: Bullet | null = null;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => {
                      if (i.id !== itemId) return i;
                      removed = i.bullets.find((b) => b.id === bulletId) ?? null;
                      return {
                        ...i,
                        bullets: i.bullets.filter((b) => b.id !== bulletId),
                      };
                    }),
                  }
                : s
            ),
          }));
          return removed;
        },

        duplicateBullet: (sectionId, itemId, bulletId) => {
          let newBulletId: string | null = null;
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => {
                      if (i.id !== itemId) return i;
                      const idx = i.bullets.findIndex((b) => b.id === bulletId);
                      if (idx === -1) return i;
                      const copy: Bullet = { ...i.bullets[idx], id: newId("b") };
                      newBulletId = copy.id;
                      return {
                        ...i,
                        bullets: [
                          ...i.bullets.slice(0, idx + 1),
                          copy,
                          ...i.bullets.slice(idx + 1),
                        ],
                      };
                    }),
                  }
                : s
            ),
          }));
          return newBulletId;
        },

        updateBullet: (sectionId, itemId, bulletId, text) => {
          withAutoDetach(sectionId, itemId, (i) => ({
            ...i,
            bullets: i.bullets.map((b) =>
              b.id === bulletId ? { ...b, text } : b
            ),
          }));
        },

        // Link-aware (design §4.3 "Linked --> Linked", Req 7.2, 8.1, 8.4). On a
        // LINKED item whose entry exists this toggles membership of `bulletId`
        // in the variant-local `hiddenBulletIds` overlay; raw `bullets`, the
        // bank and the link are never touched (no detach). An id the entry does
        // not have is a silent no-op. An empty overlay omits the key.
        // Detached, local and ORPHANED items keep the legacy behavior: flip
        // `hidden` on the raw bullet (an orphan's raw bullets hold its wording).
        // The editor lists overlay-hidden bullets for un-hiding via
        // `overlayHiddenBullets` (BulletList, task 8.3).
        toggleBulletHidden: (sectionId, itemId, bulletId) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const raw = findRawItem(variant, sectionId, itemId);
          if (raw && raw.link && linkState(raw) === "linked") {
            const entry = state.bank.find((b) => b.id === raw.link!.bankId);
            if (entry) {
              if (!entry.bullets.some((b) => b.id === bulletId)) return;
              const current = raw.hiddenBulletIds ?? [];
              const next = current.includes(bulletId)
                ? current.filter((id) => id !== bulletId)
                : [...current, bulletId];
              const { hiddenBulletIds: _old, ...rest } = raw;
              const updated: Item = next.length
                ? { ...rest, hiddenBulletIds: next }
                : rest;
              updateCurrent((r) => ({
                ...r,
                sections: r.sections.map((s) =>
                  s.id === sectionId
                    ? {
                        ...s,
                        items: s.items.map((i) => (i.id === itemId ? updated : i)),
                      }
                    : s
                ),
              }));
              return;
            }
          }
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) =>
                      i.id === itemId
                        ? {
                            ...i,
                            bullets: i.bullets.map((b) =>
                              b.id === bulletId ? { ...b, hidden: !b.hidden } : b
                            ),
                          }
                        : i
                    ),
                  }
                : s
            ),
          }));
        },

        // Link-aware (design §4.3, §5.5, Req 7.2, 8.2, 8.3, 8.4). On a LINKED
        // item whose entry exists this writes the variant-local `bulletOrder`
        // overlay; raw `bullets`, the bank and the link are never touched (no
        // detach). `orderedIds` is normalized: ids the entry does not have are
        // dropped and duplicates keep their first occurrence. The editor passes
        // only the bullets it shows (overlay-hidden ones are excluded); those
        // are filtered out before resolution applies the order, so omitting
        // them is correct. Bullets absent from the order (e.g. added to the
        // entry later) append in entry order (Req 8.3). An empty order omits
        // the key; an unchanged order is a true no-op.
        // Detached, local and ORPHANED items keep the legacy behavior: reorder
        // the raw `bullets`.
        reorderBullets: (sectionId, itemId, orderedIds) => {
          const state = get();
          const variant =
            state.variants.find((v) => v.id === state.currentVariantId) ??
            state.variants[0];
          const raw = findRawItem(variant, sectionId, itemId);
          if (raw && raw.link && linkState(raw) === "linked") {
            const entry = state.bank.find((b) => b.id === raw.link!.bankId);
            if (entry) {
              const known = new Set(entry.bullets.map((b) => b.id));
              const seen = new Set<string>();
              const next: string[] = [];
              for (const id of orderedIds) {
                if (known.has(id) && !seen.has(id)) {
                  seen.add(id);
                  next.push(id);
                }
              }
              const current = raw.bulletOrder ?? [];
              if (
                next.length === current.length &&
                next.every((id, k) => id === current[k])
              )
                return;
              const { bulletOrder: _old, ...rest } = raw;
              const updated: Item = next.length
                ? { ...rest, bulletOrder: next }
                : rest;
              updateCurrent((r) => ({
                ...r,
                sections: r.sections.map((s) =>
                  s.id === sectionId
                    ? {
                        ...s,
                        items: s.items.map((i) => (i.id === itemId ? updated : i)),
                      }
                    : s
                ),
              }));
              return;
            }
          }
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) =>
                      i.id === itemId
                        ? { ...i, bullets: reorderByIds(i.bullets, orderedIds) }
                        : i
                    ),
                  }
                : s
            ),
          }));
        },

        insertBullet: (sectionId, itemId, bullet, atIndex) =>
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) => {
                      if (i.id !== itemId) return i;
                      const bullets = [...i.bullets];
                      const k = Math.max(0, Math.min(atIndex, bullets.length));
                      bullets.splice(k, 0, bullet);
                      return { ...i, bullets };
                    }),
                  }
                : s
            ),
          })),
      };
    },
    {
      name: STORAGE_KEY,
      version: 3,
      // Pure function in migrations.ts so tests can call it without a store.
      migrate: (persisted, fromVersion) =>
        migratePersistedLibrary(persisted, fromVersion) as LibraryState,
      partialize: (s) => ({
        variants: s.variants,
        currentVariantId: s.currentVariantId,
        bank: s.bank,
      }),
    }
  )
);

/**
 * The active variant with bank-linked items resolved (design §5.1, Req 6.6).
 *
 * Select `variant` and `bank` separately, then compose in `useMemo`. Never call
 * `resolveResume` inside a selector: it can return a fresh object on every
 * call, which fails zustand's `Object.is` equality check, so every store
 * notification re-renders, which re-runs the selector, which re-renders...
 *
 *   // WRONG: new reference per call, re-render loop
 *   useResumeStore((s) => {
 *     const v = s.variants.find((x) => x.id === s.currentVariantId) ?? s.variants[0];
 *     return resolveResume(v, s.bank);
 *   });
 *
 *   // RIGHT: select stable references, compose outside the selector
 *   const variant = useResumeStore(
 *     (s) => s.variants.find((v) => v.id === s.currentVariantId) ?? s.variants[0]
 *   );
 *   const bank = useResumeStore((s) => s.bank);
 *   return useMemo(() => resolveResume(variant, bank), [variant, bank]);
 *
 * Both selectors return objects that already live in the store, so they only
 * fire when that slice changes. Do not reach for `useShallow` or a custom
 * equality fn; the fix is to stop building objects inside the selector.
 * `resolveResume` preserves structural sharing, so with nothing linked this
 * returns the very same variant object that is in the store.
 */
export function useCurrentResume(): Resume {
  const variant = useResumeStore(
    (s) => s.variants.find((v) => v.id === s.currentVariantId) ?? s.variants[0]
  );
  const bank = useResumeStore((s) => s.bank);
  return useMemo(() => resolveResume(variant, bank), [variant, bank]);
}

export { findRawItem };

/**
 * The RAW item (link state, overlay fields, empty wording on a linked item) for
 * the editor to read alongside the resolved view it renders (design §4.4).
 *
 * The selector returns an object that already lives in the store, or
 * `undefined`, so it is reference-stable. It never builds a new object.
 *
 * Use this, or the value returned by the store's delete actions, for any undo
 * snapshot. The resolved item the editor receives as a prop carries bank
 * wording inlined; re-inserting it would silently break 5.4.
 */
export function useRawItem(sectionId: string, itemId: string): Item | undefined {
  return useResumeStore((s) =>
    findRawItem(
      s.variants.find((v) => v.id === s.currentVariantId) ?? s.variants[0],
      sectionId,
      itemId
    )
  );
}
