import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Bullet,
  Header,
  Item,
  Resume,
  Section,
  SectionKind,
} from "./schema";
import { newId } from "./schema";
import { makeSeedResume } from "./seed";

const STORAGE_KEY = "resume-editor:v1";

type LibraryState = {
  variants: Resume[];
  currentVariantId: string;
};

type Actions = {
  // Variant lifecycle
  setCurrentVariant: (id: string) => void;
  createVariant: (name?: string) => string;
  duplicateVariant: (id: string) => string;
  renameVariant: (id: string, name: string) => void;
  deleteVariant: (id: string) => void;
  replaceVariant: (id: string, resume: Resume) => void;
  addVariant: (resume: Resume) => string;
  replaceLibrary: (variants: Resume[]) => void;

  // Header
  updateHeader: (patch: Partial<Header>) => void;
  setLink: (index: number, label: string, url: string) => void;
  addLink: () => void;
  removeLink: (index: number) => void;
  moveLink: (from: number, to: number) => void;

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
  deleteItem: (sectionId: string, itemId: string) => Item | null;
  duplicateItem: (sectionId: string, itemId: string) => string | null;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Item>) => void;
  toggleItemHidden: (sectionId: string, itemId: string) => void;
  reorderItems: (sectionId: string, orderedIds: string[]) => void;
  insertItem: (sectionId: string, item: Item, atIndex: number) => void;

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

function reorderByIds<T extends { id: string }>(arr: T[], orderedIds: string[]): T[] {
  const byId = new Map(arr.map((x) => [x.id, x]));
  const result: T[] = [];
  for (const id of orderedIds) {
    const found = byId.get(id);
    if (found) result.push(found);
  }
  for (const x of arr) {
    if (!orderedIds.includes(x.id)) result.push(x);
  }
  return result;
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

      return {
        variants: [defaultSeed],
        currentVariantId: defaultSeed.id,

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

        replaceLibrary: (variants) => {
          if (variants.length === 0) return;
          set({ variants, currentVariantId: variants[0].id });
        },

        updateHeader: (patch) =>
          updateCurrent((r) => ({ ...r, header: { ...r.header, ...patch } })),

        setLink: (index, label, url) =>
          updateCurrent((r) => {
            const links = [...(r.header.links ?? [])];
            if (index < 0 || index >= links.length) return r;
            links[index] = { label, url };
            return { ...r, header: { ...r.header, links } };
          }),

        addLink: () =>
          updateCurrent((r) => ({
            ...r,
            header: {
              ...r.header,
              links: [...(r.header.links ?? []), { label: "", url: "" }],
            },
          })),

        removeLink: (index) =>
          updateCurrent((r) => {
            const links = (r.header.links ?? []).filter((_, i) => i !== index);
            return { ...r, header: { ...r.header, links } };
          }),

        moveLink: (from, to) =>
          updateCurrent((r) => {
            const links = [...(r.header.links ?? [])];
            if (
              from < 0 ||
              from >= links.length ||
              to < 0 ||
              to >= links.length
            )
              return r;
            const [m] = links.splice(from, 1);
            links.splice(to, 0, m);
            return { ...r, header: { ...r.header, links } };
          }),

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
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) =>
                      i.id === itemId ? { ...i, ...patch } : i
                    ),
                  }
                : s
            ),
          })),

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
          updateCurrent((r) => ({
            ...r,
            sections: r.sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    items: s.items.map((i) =>
                      i.id === itemId
                        ? { ...i, bullets: insertAfter(i.bullets, afterId, bullet) }
                        : i
                    ),
                  }
                : s
            ),
          }));
          return bullet.id;
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

        updateBullet: (sectionId, itemId, bulletId, text) =>
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
                              b.id === bulletId ? { ...b, text } : b
                            ),
                          }
                        : i
                    ),
                  }
                : s
            ),
          })),

        toggleBulletHidden: (sectionId, itemId, bulletId) =>
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
          })),

        reorderBullets: (sectionId, itemId, orderedIds) =>
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
          })),

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
      version: 1,
      partialize: (s) => ({
        variants: s.variants,
        currentVariantId: s.currentVariantId,
      }),
    }
  )
);

export function useCurrentResume(): Resume {
  return useResumeStore((s) => {
    const found = s.variants.find((v) => v.id === s.currentVariantId);
    return found ?? s.variants[0];
  });
}
