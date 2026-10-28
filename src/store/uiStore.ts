import { create } from "zustand";
import type { PageFit, Zoom } from "../components/Preview/previewScale";
import { pageFitEquals } from "../components/Preview/previewScale";
import type { SectionKind } from "./schema";

export type PaneId = "sidebar" | "editor" | "preview";

export type SidebarMode = "variants" | "bank";

export type FocusNode =
  | { kind: "header" }
  | { kind: "header-field"; fieldId: string }
  | { kind: "section"; sectionId: string }
  | { kind: "item"; sectionId: string; itemId: string }
  | { kind: "bullet"; sectionId: string; itemId: string; bulletId: string }
  | null;

export type Toast = {
  id: string;
  message: string;
  undo?: () => void;
};

type UiState = {
  focus: FocusNode;
  collapsedSections: Record<string, boolean>;
  /**
   * The second collapse level (3.1), keyed by item id. Lives here rather than
   * in `resumeStore` because collapse is a viewing state: never persisted,
   * never exported, never present in the resume JSON (3.4). This store has no
   * persist middleware, so that holds by construction.
   */
  collapsedItems: Record<string, boolean>;
  toasts: Toast[];
  paneOrder: PaneId[];
  minimizedPanes: Record<PaneId, boolean>;
  /** Explicit pane widths in px. Absent key = flex sizing. Unpersisted by design (1.4). */
  paneWidths: Partial<Record<PaneId, number>>;
  /**
   * The preview's zoom choice (2.2), written by the select in `App.tsx`'s
   * `.preview-toolbar` and read by `ResumePreview`'s scaler. It lives here
   * rather than in either component because those are the two components, and
   * neither owns the other (design §4.6).
   *
   * Unpersisted like everything else in this store: it is a viewing preference,
   * so it must never reach the resume JSON or survive a reload.
   */
  previewZoom: Zoom;
  /**
   * The page-fit estimate (4.1, 4.2), measured off `.page` by `ResumePreview`'s
   * layout effect (4.3) and read by the badge in `App.tsx`'s `.preview-toolbar`
   * (4.4). Same split as `previewZoom`, in the other direction: the measurer
   * and the renderer are sibling subtrees, so neither can hold it locally.
   *
   * `null` means nothing has been measured yet — the first layout effect has
   * not run, or `.page` was not mounted when it did. The badge renders nothing
   * rather than guessing.
   *
   * Unpersisted, like the rest of this store. It is a derived view of the
   * resume, not part of it.
   */
  pageFit: PageFit | null;
  /**
   * Which body the Variants pane shows (design §4.5, 9.1): the variant list or
   * the Bank panel. Bank CRUD lives in the sidebar so the editor and preview
   * panes gain no chrome. Unpersisted, like the rest of this store: it is a
   * viewing choice, so a reload returns to "variants".
   */
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  /**
   * A one-shot request for `BankPanel` to open a given entry, set by a linked
   * item's "Edit in Bank" button (task 6.8). The panel consumes it on mount or
   * change and clears it, so it never goes stale. Ephemeral like the rest.
   */
  bankSelection: { kind: SectionKind; id: string } | null;
  /** Switch the sidebar to Bank mode and ask the panel to open `selection`. */
  openInBank: (selection: { kind: SectionKind; id: string } | null) => void;
  clearBankSelection: () => void;
  setFocus: (f: FocusNode) => void;
  toggleSectionCollapsed: (id: string) => void;
  toggleItemCollapsed: (itemId: string) => void;
  /**
   * Collapse all / Expand all in one action (3.2, 3.3): sets every given
   * section id and item id to `collapsed`. Both maps are rebuilt from the ids
   * passed in, so ids that no longer exist in the active variant drop out
   * instead of accumulating.
   */
  setAllCollapsed: (
    sectionIds: string[],
    itemIds: string[],
    collapsed: boolean,
  ) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setPaneOrder: (order: PaneId[]) => void;
  togglePaneMinimized: (pane: PaneId) => void;
  /** Pass `undefined` to clear the explicit width and return the pane to flex sizing (1.2). */
  setPaneWidth: (pane: PaneId, width: number | undefined) => void;
  setPreviewZoom: (zoom: Zoom) => void;
  /**
   * Write the measured page-fit result.
   *
   * Idempotent on an unchanged value: the caller is a `useLayoutEffect`, so an
   * unconditional write would re-render the badge's subtree on every
   * measurement and re-trigger the effect. The comparison lives here rather
   * than at the call site so there is exactly one place that can forget it.
   */
  setPageFit: (fit: PageFit | null) => void;
};

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  focus: null,
  collapsedSections: {},
  collapsedItems: {},
  toasts: [],
  paneOrder: ["sidebar", "editor", "preview"],
  minimizedPanes: { sidebar: false, editor: false, preview: false },
  paneWidths: {},
  // Fit is the default (2.2): the pane is usually narrower than the page, and a
  // clipped first paint is the bug this feature exists to fix.
  previewZoom: "fit",
  pageFit: null,
  sidebarMode: "variants",
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  bankSelection: null,
  openInBank: (bankSelection) => set({ sidebarMode: "bank", bankSelection }),
  clearBankSelection: () => set({ bankSelection: null }),
  setFocus: (focus) => set({ focus }),
  toggleSectionCollapsed: (id) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [id]: !s.collapsedSections[id],
      },
    })),
  toggleItemCollapsed: (itemId) =>
    set((s) => ({
      collapsedItems: {
        ...s.collapsedItems,
        [itemId]: !s.collapsedItems[itemId],
      },
    })),
  setAllCollapsed: (sectionIds, itemIds, collapsed) =>
    set(() => {
      const collapsedSections: Record<string, boolean> = {};
      for (const id of sectionIds) collapsedSections[id] = collapsed;
      const collapsedItems: Record<string, boolean> = {};
      for (const id of itemIds) collapsedItems[id] = collapsed;
      return { collapsedSections, collapsedItems };
    }),
  pushToast: (t) => {
    const id = `t${++toastCounter}`;
    const toast: Toast = { ...t, id };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 6000);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPaneOrder: (order) => set({ paneOrder: order }),
  togglePaneMinimized: (pane) =>
    set((s) => ({
      minimizedPanes: { ...s.minimizedPanes, [pane]: !s.minimizedPanes[pane] },
    })),
  setPaneWidth: (pane, width) =>
    set((s) => {
      const next = { ...s.paneWidths };
      if (width === undefined || !Number.isFinite(width)) {
        delete next[pane];
      } else {
        next[pane] = width;
      }
      return { paneWidths: next };
    }),
  setPreviewZoom: (previewZoom) => set({ previewZoom }),
  // Returning `s` unchanged makes zustand skip notifying subscribers, so a
  // re-measure that lands on the same value is a true no-op.
  setPageFit: (pageFit) =>
    set((s) => (pageFitEquals(s.pageFit, pageFit) ? s : { pageFit })),
}));
