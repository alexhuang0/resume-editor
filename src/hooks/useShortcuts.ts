import { useHotkeys } from "react-hotkeys-hook";
import { useResumeStore } from "../store/resumeStore";
import { useUiStore } from "../store/uiStore";

/* Keyboard shortcuts scoped to the focused node (set via uiStore.focus). */
export function useEditorShortcuts() {
  const focusRef = useUiStore((s) => s.focus);
  const store = useResumeStore;

  const focused = focusRef;

  useHotkeys(
    "mod+enter",
    (e) => {
      if (!focused) return;
      if (focused.kind === "bullet") {
        e.preventDefault();
        store
          .getState()
          .addBullet(focused.sectionId, focused.itemId, focused.bulletId);
      } else if (focused.kind === "item") {
        e.preventDefault();
        store.getState().addBullet(focused.sectionId, focused.itemId);
      } else if (focused.kind === "header-field") {
        e.preventDefault();
        const id = store.getState().addHeaderField(focused.fieldId);
        useUiStore.getState().setFocus({ kind: "header-field", fieldId: id });
      }
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );

  useHotkeys(
    "mod+shift+enter",
    (e) => {
      if (!focused) return;
      if (focused.kind === "item" || focused.kind === "bullet") {
        e.preventDefault();
        const afterId = focused.kind === "item" ? focused.itemId : focused.itemId;
        store.getState().addItem(focused.sectionId, afterId);
      } else if (focused.kind === "section") {
        e.preventDefault();
        const r = store.getState();
        const variant = r.variants.find((v) => v.id === r.currentVariantId);
        const section = variant?.sections.find((s) => s.id === focused.sectionId);
        if (section) store.getState().addItem(section.id);
      } else if (focused.kind === "header-field") {
        e.preventDefault();
        const id = store.getState().addHeaderField(focused.fieldId);
        useUiStore.getState().setFocus({ kind: "header-field", fieldId: id });
      }
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );

  useHotkeys(
    "mod+d",
    (e) => {
      if (!focused) return;
      e.preventDefault();
      const s = store.getState();
      if (focused.kind === "section") s.duplicateSection(focused.sectionId);
      else if (focused.kind === "item")
        s.duplicateItem(focused.sectionId, focused.itemId);
      else if (focused.kind === "bullet")
        s.duplicateBullet(focused.sectionId, focused.itemId, focused.bulletId);
      else if (focused.kind === "header-field") {
        const newId = s.duplicateHeaderField(focused.fieldId);
        if (newId) useUiStore.getState().setFocus({ kind: "header-field", fieldId: newId });
      }
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );

  useHotkeys(
    "mod+h",
    (e) => {
      if (!focused) return;
      e.preventDefault();
      const s = store.getState();
      if (focused.kind === "section") s.toggleSectionHidden(focused.sectionId);
      else if (focused.kind === "item")
        s.toggleItemHidden(focused.sectionId, focused.itemId);
      else if (focused.kind === "bullet")
        s.toggleBulletHidden(focused.sectionId, focused.itemId, focused.bulletId);
      else if (focused.kind === "header-field")
        s.toggleHeaderFieldHidden(focused.fieldId);
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );

  const moveFocused = (direction: -1 | 1) => {
    if (!focused) return;
    const s = store.getState();
    const variant = s.variants.find((v) => v.id === s.currentVariantId);
    if (!variant) return;
    if (focused.kind === "section") {
      const ids = variant.sections.map((x) => x.id);
      const idx = ids.indexOf(focused.sectionId);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      [next[idx], next[target]] = [next[target], next[idx]];
      s.reorderSections(next);
    } else if (focused.kind === "item") {
      const section = variant.sections.find((x) => x.id === focused.sectionId);
      if (!section) return;
      const ids = section.items.map((x) => x.id);
      const idx = ids.indexOf(focused.itemId);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      [next[idx], next[target]] = [next[target], next[idx]];
      s.reorderItems(section.id, next);
    } else if (focused.kind === "bullet") {
      const section = variant.sections.find((x) => x.id === focused.sectionId);
      const item = section?.items.find((x) => x.id === focused.itemId);
      if (!item) return;
      const ids = item.bullets.map((x) => x.id);
      const idx = ids.indexOf(focused.bulletId);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      [next[idx], next[target]] = [next[target], next[idx]];
      s.reorderBullets(focused.sectionId, focused.itemId, next);
    } else if (focused.kind === "header-field") {
      const ids = variant.header.fields.map((x) => x.id);
      const idx = ids.indexOf(focused.fieldId);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      [next[idx], next[target]] = [next[target], next[idx]];
      s.reorderHeaderFields(next);
    }
  };

  useHotkeys(
    "mod+up",
    (e) => {
      if (!focused) return;
      e.preventDefault();
      moveFocused(-1);
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );

  useHotkeys(
    "mod+down",
    (e) => {
      if (!focused) return;
      e.preventDefault();
      moveFocused(1);
    },
    { enableOnFormTags: ["textarea", "input"] },
    [focused]
  );
}
