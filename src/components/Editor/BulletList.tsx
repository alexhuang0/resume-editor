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
  /** Linked item (entry present): ✕ hides, Duplicate is off (task 8.3). */
  linked?: boolean;
  /** Bullets this variant's overlay hides; resolved lists omit them. */
  hiddenBullets?: Bullet[];
};

const LINKED_DELETE_TITLE =
  "Linked item: hides this bullet in this variant. Delete it from the Bank panel to remove it everywhere.";

function BulletRow({
  bullet,
  sectionId,
  itemId,
  linked,
}: {
  bullet: Bullet;
  sectionId: string;
  itemId: string;
  linked: boolean;
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
    // Linked bullets never get here: their ✕ is the hide action (below).
    if (index < 0) return;
    const snapshot = remove(sectionId, itemId, bullet.id);
    if (!snapshot) return;
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
      {/* On a linked item this toggles the variant overlay. `bullet.hidden` is
          the BANK's flag, which the overlay cannot clear, so a bullet the bank
          hid keeps its dimmed look here; it can only be un-hidden in the Bank.
          Hiding it here moves it to the "hidden in this variant" list. */}
      <HideToggle hidden={bullet.hidden} onToggle={() => toggle(sectionId, itemId, bullet.id)} />
      <button
        className="btn small"
        title={linked ? "Edit in Bank or detach to duplicate bullets" : "Duplicate"}
        disabled={linked}
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
        title={linked ? LINKED_DELETE_TITLE : "Delete"}
        aria-label={linked ? "Hide bullet in this variant" : "Delete bullet"}
        onClick={linked ? () => toggle(sectionId, itemId, bullet.id) : handleDelete}
      >
        ✕
      </button>
    </li>
  );
}

export function BulletList({
  sectionId,
  itemId,
  bullets,
  linked = false,
  hiddenBullets = [],
}: Props) {
  const reorder = useResumeStore((s) => s.reorderBullets);
  const toggle = useResumeStore((s) => s.toggleBulletHidden);
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
              <BulletRow
                key={b.id}
                bullet={b}
                sectionId={sectionId}
                itemId={itemId}
                linked={linked}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {linked && hiddenBullets.length > 0 && (
        <details className="hidden-bullets">
          <summary>{hiddenBullets.length} hidden in this variant</summary>
          <ul className="bullets-list">
            {hiddenBullets.map((b) => (
              <li key={b.id} className="editor-row bullet">
                <span className="hidden-bullet-text" title={b.text}>
                  {b.text}
                </span>
                <button
                  className="btn small"
                  aria-label={`Unhide bullet: ${b.text.slice(0, 40)}`}
                  onClick={() => toggle(sectionId, itemId, b.id)}
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        className="btn small"
        style={{ marginTop: 6 }}
        onClick={() => add(sectionId, itemId)}
      >
        + Add bullet
      </button>
    </>
  );
}
