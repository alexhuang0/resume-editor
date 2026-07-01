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
import { useResumeStore, useCurrentResume } from "./store/resumeStore";
import { useUiStore } from "./store/uiStore";
import type { PaneId } from "./store/uiStore";
import { VariantsSidebar } from "./components/VariantsSidebar";
import { HeaderEditor } from "./components/Editor/HeaderEditor";
import { SectionList } from "./components/Editor/SectionList";
import { ResumePreview } from "./components/Preview/ResumePreview";
import { Toasts } from "./components/Toasts";
import { useEditorShortcuts } from "./hooks/useShortcuts";
import { exportMarkdownFile } from "./exporters/importExport";
import { resumeToMarkdown } from "./exporters/toMarkdown";
import type { FontChoice } from "./store/schema";

type SortablePaneProps = {
  id: PaneId;
  label: string;
  minimized: boolean;
  onToggleMinimize: () => void;
  children: React.ReactNode;
};

function SortablePane({
  id,
  label,
  minimized,
  onToggleMinimize,
  children,
}: SortablePaneProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
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
  const resume = useCurrentResume();
  const setFont = useResumeStore((s) => s.setFont);
  const paneOrder = useUiStore((s) => s.paneOrder);
  const minimizedPanes = useUiStore((s) => s.minimizedPanes);
  const setPaneOrder = useUiStore((s) => s.setPaneOrder);
  const togglePaneMinimized = useUiStore((s) => s.togglePaneMinimized);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  const paneContent: Record<PaneId, { label: string; node: React.ReactNode }> = {
    sidebar: {
      label: "Variants",
      node: <VariantsSidebar />,
    },
    editor: {
      label: "Editor",
      node: (
        <main className="editor">
          <h2>{resume.name}</h2>
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
            <div className="right">
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
          {paneOrder.map((paneId) => (
            <SortablePane
              key={paneId}
              id={paneId}
              label={paneContent[paneId].label}
              minimized={minimizedPanes[paneId]}
              onToggleMinimize={() => togglePaneMinimized(paneId)}
            >
              {paneContent[paneId].node}
            </SortablePane>
          ))}
        </SortableContext>
      </DndContext>
      <Toasts />
    </div>
  );
}

export default App;
