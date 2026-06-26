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
import type { Bullet } from "../../store/schema";
import { useUiStore } from "../../store/uiStore";
import { HideToggle } from "./HideToggle";

type Props = {
  sectionId: string;
  itemId: string;
  bullets: Bullet[];
};

function BulletRow({
  bullet,
  sectionId,
  itemId,
}: {
  bullet: Bullet;
  sectionId: string;
  itemId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bullet.id });
  const update = useResumeStore((s) => s.updateBullet);
  const remove = useResumeStore((s) => s.deleteBullet);
  const dup = useResumeStore((s) => s.duplicateBullet);
  const add = useResumeStore((s) => s.addBullet);
  const insertBullet = useResumeStore((s) => s.insertBullet);
  const toggle = useResumeStore((s) => s.toggleBulletHidden);
  const setFocus = useUiStore((s) => s.setFocus);
  const pushToast = useUiStore((s) => s.pushToast);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const handleDelete = () => {
    // Capture position before delete so undo can restore it.
    const r = useResumeStore.getState();
    const variant = r.variants.find((v) => v.id === r.currentVariantId);
    const section = variant?.sections.find((s) => s.id === sectionId);
    const item = section?.items.find((i) => i.id === itemId);
    const index = item?.bullets.findIndex((b) => b.id === bullet.id) ?? -1;
    const snapshot: Bullet = { ...bullet };
    remove(sectionId, itemId, bullet.id);
    pushToast({
      message: "Bullet deleted",
      undo: () => {
        if (index >= 0) insertBullet(sectionId, itemId, snapshot, index);
      },
    });
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`editor-row bullet ${bullet.hidden ? "hidden-node" : ""}`}
      onFocus={() =>
        setFocus({ kind: "bullet", sectionId, itemId, bulletId: bullet.id })
      }
    >
      <span className="drag-handle" {...attributes} {...listeners} title="Drag">
        ⠿
      </span>
      <textarea
        className="bullet-text"
        value={bullet.text}
        rows={1}
        onChange={(e) =>
          update(sectionId, itemId, bullet.id, e.target.value)
        }
        onFocus={() =>
          setFocus({ kind: "bullet", sectionId, itemId, bulletId: bullet.id })
        }
        placeholder="Bullet text"
      />
      <HideToggle hidden={bullet.hidden} onToggle={() => toggle(sectionId, itemId, bullet.id)} />
      <button
        className="btn small"
        title="Duplicate"
        onClick={() => dup(sectionId, itemId, bullet.id)}
      >
        ⎘
      </button>
      <button
        className="btn small"
        title="Insert below"
        onClick={() => add(sectionId, itemId, bullet.id)}
      >
        +
      </button>
      <button
        className="btn small danger"
        title="Delete"
        onClick={handleDelete}
      >
        ✕
      </button>
    </li>
  );
}

export function BulletList({ sectionId, itemId, bullets }: Props) {
  const reorder = useResumeStore((s) => s.reorderBullets);
  const add = useResumeStore((s) => s.addBullet);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = bullets.map((b) => b.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    reorder(sectionId, itemId, next);
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={bullets.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ul className="bullets-list">
            {bullets.map((b) => (
              <BulletRow key={b.id} bullet={b} sectionId={sectionId} itemId={itemId} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button className="btn small" style={{ marginTop: 6 }} onClick={() => add(sectionId, itemId)}>
        + Add bullet
      </button>
    </>
  );
}
