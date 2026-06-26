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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useResumeStore, useCurrentResume } from "../../store/resumeStore";
import type { SectionKind } from "../../store/schema";
import { SectionEditor } from "./SectionEditor";

const KINDS: { kind: SectionKind; label: string }[] = [
  { kind: "experience", label: "Experience" },
  { kind: "education", label: "Education" },
  { kind: "projects", label: "Projects" },
  { kind: "skills", label: "Skills" },
  { kind: "custom", label: "Custom" },
];

export function SectionList() {
  const resume = useCurrentResume();
  const reorder = useResumeStore((s) => s.reorderSections);
  const addSection = useResumeStore((s) => s.addSection);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = resume.sections.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    reorder(next);
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={resume.sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {resume.sections.map((s) => (
            <SectionEditor key={s.id} section={s} />
          ))}
        </SortableContext>
      </DndContext>

      <div className="add-section-menu">
        <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
          Add section:
        </span>
        {KINDS.map((k) => (
          <button key={k.kind} className="btn small" onClick={() => addSection(k.kind)}>
            + {k.label}
          </button>
        ))}
      </div>
    </>
  );
}
