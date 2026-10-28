import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

/**
 * Collapse state only (3.1). The store is used outside React here — zustand's
 * `getState`/`setState` need no DOM, which keeps this inside the node-only
 * test setup.
 */
describe("uiStore collapse state", () => {
  beforeEach(() => {
    useUiStore.setState({ collapsedSections: {}, collapsedItems: {} });
  });

  it("starts with nothing collapsed", () => {
    expect(useUiStore.getState().collapsedItems).toEqual({});
  });

  it("toggleItemCollapsed flips an item on and back off", () => {
    const { toggleItemCollapsed } = useUiStore.getState();

    toggleItemCollapsed("item-1");
    expect(useUiStore.getState().collapsedItems["item-1"]).toBe(true);

    toggleItemCollapsed("item-1");
    expect(useUiStore.getState().collapsedItems["item-1"]).toBe(false);
  });

  it("toggleItemCollapsed leaves other items and all sections alone", () => {
    const { toggleItemCollapsed, toggleSectionCollapsed } =
      useUiStore.getState();

    toggleSectionCollapsed("sec-1");
    toggleItemCollapsed("item-1");

    const s = useUiStore.getState();
    expect(s.collapsedItems["item-2"]).toBeUndefined();
    expect(s.collapsedSections).toEqual({ "sec-1": true });
  });

  it("setAllCollapsed collapses every given section and item in one action", () => {
    useUiStore.getState().setAllCollapsed(["sec-1", "sec-2"], ["a", "b"], true);

    const s = useUiStore.getState();
    expect(s.collapsedSections).toEqual({ "sec-1": true, "sec-2": true });
    expect(s.collapsedItems).toEqual({ a: true, b: true });
  });

  it("setAllCollapsed with false expands everything previously collapsed", () => {
    const { setAllCollapsed } = useUiStore.getState();

    setAllCollapsed(["sec-1"], ["a", "b"], true);
    setAllCollapsed(["sec-1"], ["a", "b"], false);

    const s = useUiStore.getState();
    expect(s.collapsedSections["sec-1"]).toBe(false);
    expect(s.collapsedItems["a"]).toBe(false);
    expect(s.collapsedItems["b"]).toBe(false);
  });

  it("setAllCollapsed drops ids that are no longer in the active variant", () => {
    const { setAllCollapsed } = useUiStore.getState();

    setAllCollapsed(["sec-1"], ["gone"], true);
    setAllCollapsed(["sec-1"], ["still-here"], true);

    expect(useUiStore.getState().collapsedItems).toEqual({
      "still-here": true,
    });
  });

  it("setAllCollapsed on empty id lists clears both maps", () => {
    const { setAllCollapsed } = useUiStore.getState();

    setAllCollapsed(["sec-1"], ["a"], true);
    setAllCollapsed([], [], true);

    const s = useUiStore.getState();
    expect(s.collapsedSections).toEqual({});
    expect(s.collapsedItems).toEqual({});
  });
});

describe("uiStore sidebar mode", () => {
  it("defaults to variants and setSidebarMode switches it", () => {
    expect(useUiStore.getState().sidebarMode).toBe("variants");

    useUiStore.getState().setSidebarMode("bank");
    expect(useUiStore.getState().sidebarMode).toBe("bank");

    useUiStore.getState().setSidebarMode("variants");
    expect(useUiStore.getState().sidebarMode).toBe("variants");
  });
});
