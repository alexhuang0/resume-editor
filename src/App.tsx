import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, useEffect, useRef } from "react";
import { useResumeStore, useCurrentResume } from "./store/resumeStore";
import { collapseTargets } from "./store/collapseTargets";
import { useUiStore } from "./store/uiStore";
import type { PaneId } from "./store/uiStore";
import { VariantsSidebar } from "./components/VariantsSidebar";
import { HeaderEditor } from "./components/Editor/HeaderEditor";
import { SectionList } from "./components/Editor/SectionList";
import { ResumePreview } from "./components/Preview/ResumePreview";
import { pageFitLabel } from "./components/Preview/previewScale";
import type { Zoom } from "./components/Preview/previewScale";
import { Toasts } from "./components/Toasts";
import { AccountControl } from "./sync/AccountControl";
import { ConflictPrompt } from "./sync/ConflictPrompt";
import { useAuth } from "./sync/useAuth";
import { startController, stopController } from "./sync/syncController";
import { useEditorShortcuts } from "./hooks/useShortcuts";
import { exportMarkdownFile } from "./exporters/importExport";
import { resumeToMarkdown } from "./exporters/toMarkdown";
import type { FontChoice } from "./store/schema";

type SortablePaneProps = {
  id: PaneId;
  label: string;
  minimized: boolean;
  /**
   * Explicit width in px from `uiStore.paneWidths`, or `undefined` for flex
   * sizing (1.2). See the `flex` line in the style object below.
   */
  width: number | undefined;
  onToggleMinimize: () => void;
  children: React.ReactNode;
};

/**
 * Resize floors in px, so no pane can be dragged to zero (1.3).
 *
 * `editor` mirrors `.pane-editor { min-width: 420px }` in app.css and must stay
 * in step with it: the CSS refuses to honor anything smaller, so a lower floor
 * here would write a width the pane ignores and the divider would visibly
 * desync from the pane edge. The other two declare no `min-width`, so these are
 * floors rather than mirrors — both sit below their flex basis (`sidebar` 240px,
 * `preview` auto) so those panes can still be narrowed, just not to nothing.
 */
const PANE_MIN_WIDTH_PX: Record<PaneId, number> = {
  sidebar: 160,
  editor: 420,
  preview: 240,
};

/**
 * Travel below this many px in a single gesture counts as a click, not a drag.
 *
 * This is what keeps the double-click reset (1.2) from fighting the drag (1.1):
 * a double-click is two full pointerdown/pointerup pairs, and a hand resting on
 * a mouse jitters a pixel or two between them, so without a slop band the reset
 * gesture would also write a width on its way through.
 */
const DIVIDER_CLICK_SLOP_PX = 3;

/**
 * The zoom control's options (2.2), Fit first because it is the default.
 *
 * `Zoom` is half string and half number, and a `<select>` only speaks strings,
 * so the mapping is a lookup table rather than a cast: `String(0.5)` round-trips
 * through `Number` fine, but a table keeps the parse total — an unrecognized
 * value falls back to Fit instead of becoming `NaN` and scaling the page away.
 */
const ZOOM_OPTIONS: { value: string; label: string; zoom: Zoom }[] = [
  { value: "fit", label: "Fit", zoom: "fit" },
  { value: "0.5", label: "50%", zoom: 0.5 },
  { value: "0.75", label: "75%", zoom: 0.75 },
  { value: "1", label: "100%", zoom: 1 },
];

function zoomOptionValue(zoom: Zoom): string {
  return ZOOM_OPTIONS.find((o) => o.zoom === zoom)?.value ?? "fit";
}

function parseZoomOptionValue(value: string): Zoom {
  return ZOOM_OPTIONS.find((o) => o.value === value)?.zoom ?? "fit";
}

/** In-flight divider drag. Captured on `pointerdown`, cleared on `pointerup`. */
type PaneDrag = {
  /** The pane to the left of the divider — the one whose width we are writing. */
  pane: PaneId;
  /** Pointer x at the start of the gesture. */
  startX: number;
  /** The left pane's laid-out width at the start of the gesture. */
  startWidth: number;
  /** The left pane's own floor. */
  minWidth: number;
  /**
   * Where the *right* pane's floor stops the gesture. Dragging right grows the
   * left pane out of the right pane's width, so clamping only the pane being
   * written would still let its neighbour be squeezed to zero.
   */
  maxWidth: number;
  /**
   * Set once the pointer travels past `DIVIDER_CLICK_SLOP_PX`. Until then the
   * gesture is still a candidate click and writes nothing.
   */
  moved: boolean;
};

function SortablePane({
  id,
  label,
  minimized,
  width,
  onToggleMinimize,
  children,
}: SortablePaneProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        // dnd-kit's reorder transform shares this object, so the width has to
        // be merged into it rather than replacing it.
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        // `0 0` and not `0 1`: a grow or shrink factor would let the flex
        // algorithm move the pane off the width the drag just wrote, which is
        // the one thing an explicit width has to rule out (1.1).
        //
        // `undefined` is what makes the fall-through work — React omits the
        // property entirely, so an unset pane is still sized by app.css
        // (`.pane-sidebar` 0 0 240px, `.pane-editor` 1 1 420px) and the
        // double-click reset (1.2) is a plain return to that.
        //
        // Two stylesheet rules deliberately outrank this value even while it
        // is set: `.pane-minimized`'s `flex: 0 0 32px !important` wins on
        // `!important`, so a stored width cannot un-collapse a minimized pane;
        // and `.pane-editor`'s `min-width: 420px` floors the basis regardless,
        // which is why PANE_MIN_WIDTH_PX mirrors it rather than undercutting it.
        flex: width !== undefined ? `0 0 ${width}px` : undefined,
      }}
      className={`pane-wrapper pane-${id}${minimized ? " pane-minimized" : ""}`}
    >
      <div className="pane-bar">
        <span
          className="pane-drag-handle"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </span>
        <span className="pane-label">{label}</span>
        <button
          className="btn small ghost pane-min-btn"
          title={minimized ? "Expand" : "Minimize"}
          onClick={onToggleMinimize}
        >
          {minimized ? "+" : "−"}
        </button>
      </div>
      {!minimized && <div className="pane-content">{children}</div>}
    </div>
  );
}

function App() {
  useEditorShortcuts();

  // The app root owns auth resolution and the sync controller's lifecycle.
  //
  // `useAuth()` is the single driver of auth state (design §2). AccountControl
  // also calls it, but the module-level `wired` guard inside makes the Supabase
  // subscription idempotent, so calling it here as well is safe and hands the
  // root the reactive { status, userId } the controller effect needs. In
  // Local_Only_Mode `useAuth` resolves straight to `signed_out` and never
  // subscribes, so this stays inert and no network call fires (Req 8.4).
  const { status, userId } = useAuth();

  // Tie the controller to auth status: start it when a user is signed in, stop
  // it on sign-out. `startController(userId)` is idempotent per user (a repeat
  // start for the same id is a no-op), so a `signed_in` re-render — e.g. on a
  // token refresh — can't thrash it. `stopController()` runs whenever we leave
  // signed-in (status change or unmount), tearing down the store subscription,
  // the debounce, and any pending conflict.
  //
  // Nothing here gates the editor: this effect only governs the sync layer, so
  // the local library still renders during `resolving` and in Local_Only_Mode
  // before any auth request (Req 1.1–1.3, 1.6, 3.6).
  useEffect(() => {
    if (status === "signed_in" && userId) {
      void startController(userId);
      return () => stopController();
    }
    if (status === "signed_out") {
      stopController();
    }
    // `resolving`: do nothing — never block the first paint on session restore.
    return undefined;
  }, [status, userId]);

  const resume = useCurrentResume();
  const setFont = useResumeStore((s) => s.setFont);
  const paneOrder = useUiStore((s) => s.paneOrder);
  const minimizedPanes = useUiStore((s) => s.minimizedPanes);
  // `setPaneWidth` replaces this object on every pointermove, so subscribing
  // here is what re-renders the panes mid-drag — that live reflow is the
  // requirement (1.1), not an accident worth memoizing away.
  const paneWidths = useUiStore((s) => s.paneWidths);
  const setPaneOrder = useUiStore((s) => s.setPaneOrder);
  const togglePaneMinimized = useUiStore((s) => s.togglePaneMinimized);
  const setPaneWidth = useUiStore((s) => s.setPaneWidth);
  // The select lives here and the scaler lives in `ResumePreview`, so the value
  // round-trips through `uiStore` (design §4.6).
  const previewZoom = useUiStore((s) => s.previewZoom);
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom);
  // Written by `ResumePreview`'s layout effect, read here so the badge sits in
  // the unscaled toolbar (4.2, 4.3). `null` until the first measurement.
  const pageFit = useUiStore((s) => s.pageFit);
  const setAllCollapsed = useUiStore((s) => s.setAllCollapsed);

  // Kept in a ref, not state: the drag writes to `uiStore` on every move, and
  // a second re-render per move buys nothing.
  const paneDrag = useRef<PaneDrag | null>(null);
  // Outlives `paneDrag`, which is cleared on pointerup: `dblclick` fires after
  // the second pointerup of the pair, so this is the only place it can still
  // learn whether that gesture resized anything.
  const lastGestureWasDrag = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const divider = e.currentTarget;
    const pane = divider.dataset.leftPane as PaneId | undefined;
    // The divider is rendered as a flex sibling directly after its left pane,
    // so the previous element sibling *is* that pane — and it stays correct
    // when `paneOrder` changes, since the divider moves with it.
    const leftPane = divider.previousElementSibling;
    if (!pane || !(leftPane instanceof HTMLElement)) return;
    if (!leftPane.classList.contains("pane-wrapper")) return;

    // Same reasoning in the other direction: the divider sits directly before
    // the right-hand pane, and `paneOrder` names it, so both stay correct
    // across a reorder.
    const rightPaneEl = divider.nextElementSibling;
    const rightPane = paneOrder[paneOrder.indexOf(pane) + 1];
    const startWidth = leftPane.offsetWidth;
    const minWidth = PANE_MIN_WIDTH_PX[pane];
    const maxWidth =
      rightPane !== undefined && rightPaneEl instanceof HTMLElement
        ? Math.max(
            minWidth,
            startWidth + (rightPaneEl.offsetWidth - PANE_MIN_WIDTH_PX[rightPane])
          )
        : Number.POSITIVE_INFINITY;

    paneDrag.current = {
      pane,
      startX: e.clientX,
      startWidth,
      minWidth,
      maxWidth,
      moved: false,
    };
    // Pointer capture routes every subsequent move/up to the divider itself,
    // so the drag survives the cursor leaving the 6px hit target — no
    // document-level listeners, and nothing to leak on unmount.
    divider.setPointerCapture(e.pointerId);
    // The divider lives outside both panes' DOM subtrees, so this gesture can
    // never reach the `⠿` handle's dnd-kit listeners. Stopping it anyway keeps
    // that true if the tree is ever rearranged; preventDefault suppresses the
    // text selection that otherwise follows the cursor across the panes.
    e.stopPropagation();
    e.preventDefault();
  };

  const handleDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = paneDrag.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    // Latching, not per-move: once the gesture is a drag it stays one, so
    // dragging back through the start point keeps writing instead of falling
    // silent in the middle of the stroke.
    if (!drag.moved) {
      if (Math.abs(dx) <= DIVIDER_CLICK_SLOP_PX) return;
      drag.moved = true;
    }
    const next = drag.startWidth + dx;
    // Floor first, ceiling second: `maxWidth` is already floored to `minWidth`
    // at pointerdown, so neither bound can win at the other's expense.
    setPaneWidth(
      drag.pane,
      Math.min(drag.maxWidth, Math.max(drag.minWidth, next))
    );
  };

  const handleDividerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = paneDrag.current;
    if (!drag) return;
    lastGestureWasDrag.current = drag.moved;
    paneDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /**
   * Double-click resets the left pane to flex sizing (1.2).
   *
   * `dblclick` is a high-level event the browser derives from the click pair,
   * so it survives the `preventDefault()` the drag does on `pointerdown`, and
   * it arrives *after* the second pointerup — meaning the clear always lands
   * last and cannot be overwritten by a trailing move.
   */
  const handleDividerDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Two quick resize drags in a row also satisfy the browser's double-click
    // timing. Treating that as a reset would throw away the width the user
    // just dialled in, so an actual drag vetoes the reset.
    if (lastGestureWasDrag.current) {
      lastGestureWasDrag.current = false;
      return;
    }
    const pane = e.currentTarget.dataset.leftPane as PaneId | undefined;
    if (!pane) return;
    setPaneWidth(pane, undefined);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = paneOrder.indexOf(active.id as PaneId);
      const newIdx = paneOrder.indexOf(over.id as PaneId);
      setPaneOrder(arrayMove(paneOrder, oldIdx, newIdx));
    }
  };

  const handleMarkdownExport = () => {
    exportMarkdownFile(resume, resumeToMarkdown(resume));
  };

  /**
   * Collapse all / Expand all (3.2, 3.3). One click covers both levels because
   * the ids come from the resume model rather than the rendered rows — see
   * `collapseTargets`.
   *
   * This writes only to `uiStore`, which holds no resume data and has no
   * persist middleware, so the preview and the printed page are untouched
   * (3.4, 3.5).
   */
  const handleSetAllCollapsed = (collapsed: boolean) => {
    const { sectionIds, itemIds } = collapseTargets(resume);
    setAllCollapsed(sectionIds, itemIds, collapsed);
  };

  const paneContent: Record<PaneId, { label: string; node: React.ReactNode }> = {
    sidebar: {
      label: "Variants",
      node: <VariantsSidebar />,
    },
    editor: {
      label: "Editor",
      node: (
        <main className="editor">
          <div className="editor-toolbar">
            {/* Still the first `h2` under `.editor`, so `.editor h2:first-child`
                keeps zeroing its top margin. */}
            <h2>{resume.name}</h2>
            <div className="right">
              <button
                className="btn small"
                onClick={() => handleSetAllCollapsed(true)}
                title="Collapse every section and item"
              >
                Collapse all
              </button>
              <button
                className="btn small"
                onClick={() => handleSetAllCollapsed(false)}
                title="Expand every section and item"
              >
                Expand all
              </button>
            </div>
          </div>
          <HeaderEditor />
          <SectionList />
        </main>
      ),
    },
    preview: {
      label: "Preview",
      node: (
        <section className="preview">
          <div className="preview-toolbar">
            <button className="btn primary" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <button className="btn" onClick={handleMarkdownExport}>
              Export Markdown
            </button>
            {pageFit && (
              <span
                className={`page-fit-badge ${pageFit.fits ? "fits" : "over"}`}
                role="status"
                title="Estimated from the on-screen layout. Print preview may differ by about a line."
              >
                <strong>{pageFitLabel(pageFit)}</strong>
                <span className="page-fit-note">estimate, ±1 line</span>
              </span>
            )}
            <div className="right">
              {/* The account cluster (sign-in / email + sign-out + sync chip,
                  or the unconfigured indicator) lives in the preview toolbar's
                  right group — the app's always-visible top chrome. It renders
                  nothing while a session is resolving, so it never blocks the
                  first paint (design §5, Req 1.6/3.6). */}
              <AccountControl />
              <span className="zoom-toggle">
                <label htmlFor="preview-zoom">Zoom:</label>
                <select
                  id="preview-zoom"
                  value={zoomOptionValue(previewZoom)}
                  onChange={(e) => setPreviewZoom(parseZoomOptionValue(e.target.value))}
                >
                  {ZOOM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
              <span className="font-toggle">
                Font:
                <select
                  value={resume.font ?? "latin-modern"}
                  onChange={(e) => setFont(e.target.value as FontChoice)}
                >
                  <option value="latin-modern">Latin Modern (LaTeX look)</option>
                  <option value="system-serif">Georgia (max ATS compat)</option>
                </select>
              </span>
            </div>
          </div>
          <ResumePreview resume={resume} />
        </section>
      ),
    },
  };

  return (
    <div className="app">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={paneOrder} strategy={horizontalListSortingStrategy}>
          {paneOrder.map((paneId, idx) => {
            const nextPaneId = paneOrder[idx + 1];
            // A divider only exists between two adjacent non-minimized panes:
            // none after the last pane, none beside a minimized one (1.1).
            const showDivider =
              nextPaneId !== undefined &&
              !minimizedPanes[paneId] &&
              !minimizedPanes[nextPaneId];
            return (
              <Fragment key={paneId}>
                <SortablePane
                  id={paneId}
                  label={paneContent[paneId].label}
                  minimized={minimizedPanes[paneId]}
                  width={paneWidths[paneId]}
                  onToggleMinimize={() => togglePaneMinimized(paneId)}
                >
                  {paneContent[paneId].node}
                </SortablePane>
                {showDivider && (
                  // Sibling of the pane wrappers, outside either pane's DOM
                  // subtree, so a resize gesture can never reach the `⠿`
                  // reorder listeners inside a pane bar (1.5).
                  <div
                    className="pane-divider"
                    data-left-pane={paneId}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${paneContent[paneId].label} pane`}
                    onPointerDown={handleDividerPointerDown}
                    onPointerMove={handleDividerPointerMove}
                    onPointerUp={handleDividerPointerUp}
                    onPointerCancel={handleDividerPointerUp}
                    onDoubleClick={handleDividerDoubleClick}
                    title="Drag to resize, double-click to reset"
                  />
                )}
              </Fragment>
            );
          })}
        </SortableContext>
      </DndContext>
      <Toasts />
      {/* Mounted at the app root so the Cloud_Newer_Condition modal can appear
          over the editor. It renders nothing unless the controller opens a
          pending conflict (design §5 → Conflict_Prompt, Req 5.3–5.7). */}
      <ConflictPrompt />
    </div>
  );
}

export default App;
