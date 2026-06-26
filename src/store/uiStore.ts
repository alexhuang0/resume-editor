import { create } from "zustand";

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
  setFocus: (f: FocusNode) => void;
  toggleSectionCollapsed: (id: string) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
};

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  focus: null,
  collapsedSections: {},
  toasts: [],
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
}));
