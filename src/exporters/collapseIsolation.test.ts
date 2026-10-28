import { beforeEach, describe, expect, it } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { useUiStore } from "../store/uiStore";
import { collapseTargets } from "../store/collapseTargets";
import { ResumeSchema } from "../store/schema";
import { libraryJsonPayload, resumeJsonPayload } from "./importExport";

/**
 * Requirement 3.4: collapse state is UI-only — never persisted, never
 * exported, never present in the resume JSON.
 *
 * Today this holds by construction, because `collapsedSections` and
 * `collapsedItems` live in `uiStore`, which has no persist middleware and is
 * never read by the exporters. That is exactly why it needs pinning: nothing
 * about the current code *stops* someone from moving the maps into
 * `resumeStore` for persistence across reloads, and the leak would be silent —
 * the preview would look right, the printed page would look right, and only the
 * exported artifact would carry viewing state.
 *
 * So these tests assert on the bytes the exporters actually write, via the
 * payload builders the file-writing functions call. No DOM: the `download`
 * wrappers are untestable here by design (design §7), and the serialization is
 * the part that matters.
 */

function activeVariant() {
  const s = useResumeStore.getState();
  return s.variants.find((v) => v.id === s.currentVariantId) ?? s.variants[0];
}

function libraryPayload() {
  const s = useResumeStore.getState();
  return libraryJsonPayload(s.variants, s.bank);
}

describe("collapse state never reaches the exported JSON (3.4)", () => {
  beforeEach(() => {
    useUiStore.setState({ collapsedSections: {}, collapsedItems: {} });
  });

  it("the exported payload is byte-identical before and after collapsing", () => {
    const resume = activeVariant();
    const { sectionIds, itemIds } = collapseTargets(resume);

    // The seed has to actually give us something to collapse, or this test
    // would pass vacuously.
    expect(sectionIds.length).toBeGreaterThan(0);
    expect(itemIds.length).toBeGreaterThan(0);

    const before = resumeJsonPayload(resume);
    const libBefore = libraryPayload();

    useUiStore.getState().toggleSectionCollapsed(sectionIds[0]);
    useUiStore.getState().toggleItemCollapsed(itemIds[0]);

    // Sanity: the collapse actually happened, so the equality below is
    // meaningful rather than a no-op.
    expect(useUiStore.getState().collapsedSections[sectionIds[0]]).toBe(true);
    expect(useUiStore.getState().collapsedItems[itemIds[0]]).toBe(true);

    expect(resumeJsonPayload(activeVariant())).toBe(before);
    expect(libraryPayload()).toBe(libBefore);
  });

  it("Collapse all leaves the exported payload untouched", () => {
    const before = resumeJsonPayload(activeVariant());
    const { sectionIds, itemIds } = collapseTargets(activeVariant());

    useUiStore.getState().setAllCollapsed(sectionIds, itemIds, true);

    expect(Object.keys(useUiStore.getState().collapsedItems).length).toBe(
      itemIds.length,
    );
    expect(resumeJsonPayload(activeVariant())).toBe(before);
  });

  it("the serialized payload mentions no collapse key at all", () => {
    const { sectionIds, itemIds } = collapseTargets(activeVariant());
    useUiStore.getState().setAllCollapsed(sectionIds, itemIds, true);

    for (const payload of [
      resumeJsonPayload(activeVariant()),
      libraryPayload(),
    ]) {
      expect(payload).not.toContain("collapsed");
      expect(payload).not.toContain("collapsedItems");
      expect(payload).not.toContain("collapsedSections");
    }
  });

  it("the resume store holds no collapse keys to export in the first place", () => {
    const { sectionIds, itemIds } = collapseTargets(activeVariant());
    useUiStore.getState().setAllCollapsed(sectionIds, itemIds, true);

    const state = useResumeStore.getState() as unknown as Record<
      string,
      unknown
    >;
    expect(state.collapsedSections).toBeUndefined();
    expect(state.collapsedItems).toBeUndefined();

    // The persisted slice is the other escape route: anything `partialize`
    // returns lands in localStorage and survives a reload.
    const persisted = JSON.stringify({
      variants: state.variants,
      currentVariantId: state.currentVariantId,
      bank: state.bank,
    });
    expect(persisted).not.toContain("collapsed");
  });

  it("zod strips a collapse field smuggled in through import", () => {
    const resume = activeVariant();
    const smuggled = {
      ...resume,
      collapsedSections: { [resume.sections[0].id]: true },
      sections: resume.sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              collapsed: true,
              items: s.items.map((it) => ({ ...it, collapsed: true })),
            }
          : s,
      ),
    };

    const parsed = ResumeSchema.parse(smuggled);

    // zod's default object behavior is strip, so an undeclared collapse field
    // is dropped rather than carried through to the next export.
    expect(resumeJsonPayload(parsed)).not.toContain("collapsed");
  });
});
