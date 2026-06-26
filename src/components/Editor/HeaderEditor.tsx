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
import { useResumeStore, useCurrentResume } from "../../store/resumeStore";
import type { HeaderField } from "../../store/schema";
import { useUiStore } from "../../store/uiStore";
import { HideToggle } from "./HideToggle";

function HeaderFieldRow({ field }: { field: HeaderField }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const update = useResumeStore((s) => s.updateHeaderField);
  const remove = useResumeStore((s) => s.deleteHeaderField);
  const insert = useResumeStore((s) => s.insertHeaderField);
  const add = useResumeStore((s) => s.addHeaderField);
  const toggle = useResumeStore((s) => s.toggleHeaderFieldHidden);
  const setFocus = useUiStore((s) => s.setFocus);
  const pushToast = useUiStore((s) => s.pushToast);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const onFocus = () => setFocus({ kind: "header-field", fieldId: field.id });

  const handleDelete = () => {
    const r = useResumeStore.getState();
    const variant = r.variants.find((v) => v.id === r.currentVariantId);
    const index = variant?.header.fields.findIndex((f) => f.id === field.id) ?? -1;
    const snapshot: HeaderField = { ...field };
    remove(field.id);
    pushToast({
      message: "Field deleted",
      undo: () => {
        if (index >= 0) insert(snapshot, index);
      },
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`editor-row bullet${field.hidden ? " hidden-node" : ""}`}
      onFocus={onFocus}
    >
      <span className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ⠿
      </span>
      <input
        className="row-input"
        placeholder="Label"
        value={field.label}
        onChange={(e) => update(field.id, { label: e.target.value })}
        onFocus={onFocus}
        style={{ flex: 2 }}
      />
      <input
        className="row-input"
        placeholder="URL or mailto:... (optional)"
        value={field.url ?? ""}
        onChange={(e) => update(field.id, { url: e.target.value || undefined })}
        onFocus={onFocus}
        style={{ flex: 3 }}
      />
      <HideToggle hidden={field.hidden} onToggle={() => toggle(field.id)} />
      <button
        className="btn small"
        title="Insert field below"
        onClick={() => {
          const id = add(field.id);
          setTimeout(() => setFocus({ kind: "header-field", fieldId: id }), 0);
        }}
      >
        +
      </button>
      <button className="btn small danger" title="Delete field" onClick={handleDelete}>
        ✕
      </button>
    </div>
  );
}

export function HeaderEditor() {
  const resume = useCurrentResume();
  const updateHeader = useResumeStore((s) => s.updateHeader);
  const addHeaderField = useResumeStore((s) => s.addHeaderField);
  const reorderHeaderFields = useResumeStore((s) => s.reorderHeaderFields);
  const setFocus = useUiStore((s) => s.setFocus);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = resume.header.fields.map((f) => f.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    reorderHeaderFields(next);
  };

  return (
    <div
      className="header-editor"
      onFocus={() => setFocus({ kind: "header" })}
      tabIndex={-1}
    >
      <div className="row-toolbar">
        <span className="row-title">Header</span>
      </div>
      <div className="field-grid">
        <div className="full">
          <div className="field-label">Full name</div>
          <input
            className="row-input"
            value={resume.header.fullName}
            onChange={(e) => updateHeader({ fullName: e.target.value })}
          />
        </div>
      </div>
      <div className="field-label" style={{ marginTop: 10 }}>
        Contact fields
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={resume.header.fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {resume.header.fields.map((f) => (
            <HeaderFieldRow key={f.id} field={f} />
          ))}
        </SortableContext>
      </DndContext>
      <button
        className="btn small"
        style={{ marginTop: 6 }}
        onClick={() => {
          const id = addHeaderField();
          setTimeout(() => setFocus({ kind: "header-field", fieldId: id }), 0);
        }}
      >
        + Add field
      </button>
    </div>
  );
}
