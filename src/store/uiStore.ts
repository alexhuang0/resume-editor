import { create } from "zustand";
import type { Zoom } from "../components/Preview/previewScale";

export type PaneId = "sidebar" | "editor" | "preview";

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
  setFocus: (f: FocusNode) => void;
  toggleSectionCollapsed: (id: string) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setPaneOrder: (order: PaneId[]) => void;
  togglePaneMinimized: (pane: PaneId) => void;
  /** Pass `undefined` to clear the explicit width and return the pane to flex sizing (1.2). */
  setPaneWidth: (pane: PaneId, width: number | undefined) => void;
  setPreviewZoom: (zoom: Zoom) => void;
};

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  focus: null,
  collapsedSections: {},
  toasts: [],
  paneOrder: ["sidebar", "editor", "preview"],
  minimizedPanes: { sidebar: false, editor: false, preview: false },
  paneWidths: {},
  // Fit is the default (2.2): the pane is usually narrower than the page, and a
  // clipped first paint is the bug this feature exists to fix.
  previewZoom: "fit",
  setFocus: (focus) => set({ focus }),
  toggleSectionCollapsed: (id) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [id]: !s.collapsedSections[id],
      },
    })),
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
}));
