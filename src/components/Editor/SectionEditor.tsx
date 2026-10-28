import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useResumeStore } from "../../store/resumeStore";
import type { Section } from "../../store/schema";
import { useUiStore } from "../../store/uiStore";
import { BankPicker } from "./BankPicker";
import { HideToggle } from "./HideToggle";
import { ItemEditor } from "./ItemEditor";

type Props = { section: Section };

export function SectionEditor({ section }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const rename = useResumeStore((s) => s.renameSection);
  const toggle = useResumeStore((s) => s.toggleSectionHidden);
  const remove = useResumeStore((s) => s.deleteSection);
  const dup = useResumeStore((s) => s.duplicateSection);
  const addSection = useResumeStore((s) => s.addSection);
  const insertSection = useResumeStore((s) => s.insertSection);
  const addItem = useResumeStore((s) => s.addItem);
  const reorderItems = useResumeStore((s) => s.reorderItems);
  const setFocus = useUiStore((s) => s.setFocus);
  const collapsed = useUiStore((s) => !!s.collapsedSections[section.id]);
  const toggleCollapsed = useUiStore((s) => s.toggleSectionCollapsed);
  const pushToast = useUiStore((s) => s.pushToast);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = section.items.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    reorderItems(section.id, next);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const isSkills = section.kind === "skills";

  const handleDelete = () => {
    const r = useResumeStore.getState();
    const variant = r.variants.find((v) => v.id === r.currentVariantId);
    const index = variant?.sections.findIndex((s) => s.id === section.id) ?? -1;
    // `section` is the resolved view (linked items carry bank wording). Undo
    // must restore the RAW section, which `remove` returns.
    const snapshot = remove(section.id);
    if (!snapshot) return;
    pushToast({
      message: `Section "${snapshot.title}" deleted`,
      undo: () => {
        if (index >= 0) insertSection(snapshot, index);
      },
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`editor-row section ${section.hidden ? "hidden-node" : ""}`}
      onFocus={() => setFocus({ kind: "section", sectionId: section.id })}
    >
      <div className="row-toolbar">
        <span className="drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
        <button
          className="btn small ghost"
          onClick={() => toggleCollapsed(section.id)}
          title={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.title}`}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <input
          className="row-input"
          style={{ flex: 1, fontWeight: 600 }}
          value={section.title}
          onChange={(e) => rename(section.id, e.target.value)}
        />
        <HideToggle hidden={section.hidden} onToggle={() => toggle(section.id)} />
        <button className="btn small" title="Duplicate" onClick={() => dup(section.id)}>
          ⎘
        </button>
        <button
          className="btn small"
          title="Insert section below"
          onClick={() => addSection(section.kind, section.id)}
        >
          +
        </button>
        <button className="btn small danger" title="Delete" onClick={handleDelete}>
          ✕
        </button>
      </div>

      {!collapsed && (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={section.items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {section.items.map((it) => (
                <ItemEditor
                  key={it.id}
                  sectionId={section.id}
                  item={it}
                  isSkills={isSkills}
                />
              ))}
            </SortableContext>
          </DndContext>
          <div className="section-add-row">
            <button className="btn small" onClick={() => addItem(section.id)}>
              + Add {isSkills ? "skill row" : "item"}
            </button>
            <BankPicker section={section} />
          </div>
        </>
      )}
    </div>
  );
}
