import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useResumeStore } from "../../store/resumeStore";
import type { Item } from "../../store/schema";
import { useUiStore } from "../../store/uiStore";
import { HideToggle } from "./HideToggle";
import { BulletList } from "./BulletList";

type Props = {
  sectionId: string;
  item: Item;
  isSkills: boolean;
};

export function ItemEditor({ sectionId, item, isSkills }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const update = useResumeStore((s) => s.updateItem);
  const toggle = useResumeStore((s) => s.toggleItemHidden);
  const remove = useResumeStore((s) => s.deleteItem);
  const dup = useResumeStore((s) => s.duplicateItem);
  const add = useResumeStore((s) => s.addItem);
  const insertItem = useResumeStore((s) => s.insertItem);
  const setFocus = useUiStore((s) => s.setFocus);
  const pushToast = useUiStore((s) => s.pushToast);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const onFocus = () => setFocus({ kind: "item", sectionId, itemId: item.id });

  const handleDelete = () => {
    const r = useResumeStore.getState();
    const variant = r.variants.find((v) => v.id === r.currentVariantId);
    const section = variant?.sections.find((s) => s.id === sectionId);
    const index = section?.items.findIndex((i) => i.id === item.id) ?? -1;
    const snapshot: Item = JSON.parse(JSON.stringify(item));
    remove(sectionId, item.id);
    pushToast({
      message: isSkills ? "Skill row deleted" : "Item deleted",
      undo: () => {
        if (index >= 0) insertItem(sectionId, snapshot, index);
      },
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`editor-row item ${item.hidden ? "hidden-node" : ""}`}
      onFocus={onFocus}
    >
      <div className="row-toolbar">
        <span className="drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
        <span className="row-title">
          {item.heading || (isSkills ? "Skill row" : "Item")}
        </span>
        <HideToggle hidden={item.hidden} onToggle={() => toggle(sectionId, item.id)} />
        <button className="btn small" title="Duplicate" onClick={() => dup(sectionId, item.id)}>
          ⎘
        </button>
        <button className="btn small" title="Insert below" onClick={() => add(sectionId, item.id)}>
          +
        </button>
        <button className="btn small danger" title="Delete" onClick={handleDelete}>
          ✕
        </button>
      </div>

      {isSkills ? (
        <div className="field-grid">
          <div>
            <div className="field-label">Category</div>
            <input
              className="row-input"
              value={item.heading ?? ""}
              onChange={(e) => update(sectionId, item.id, { heading: e.target.value })}
              onFocus={onFocus}
            />
          </div>
          <div>
            <div className="field-label">Items (comma separated)</div>
            <input
              className="row-input"
              value={item.bullets[0]?.text ?? ""}
              onChange={(e) => {
                const bulletId = item.bullets[0]?.id;
                if (bulletId) {
                  useResumeStore
                    .getState()
                    .updateBullet(sectionId, item.id, bulletId, e.target.value);
                } else {
                  useResumeStore.getState().addBullet(sectionId, item.id);
                  // The newly added bullet will appear in the next render; the
                  // user re-typing will write into it.
                }
              }}
              onFocus={onFocus}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="field-grid">
            <div>
              <div className="field-label">Heading</div>
              <input
                className="row-input"
                value={item.heading ?? ""}
                onChange={(e) => update(sectionId, item.id, { heading: e.target.value })}
                onFocus={onFocus}
              />
            </div>
            <div>
              <div className="field-label">Subheading</div>
              <input
                className="row-input"
                value={item.subheading ?? ""}
                onChange={(e) => update(sectionId, item.id, { subheading: e.target.value })}
                onFocus={onFocus}
              />
            </div>
            <div>
              <div className="field-label">Location</div>
              <input
                className="row-input"
                value={item.location ?? ""}
                onChange={(e) => update(sectionId, item.id, { location: e.target.value })}
                onFocus={onFocus}
              />
            </div>
            <div>
              <div className="field-label">Date range</div>
              <input
                className="row-input"
                value={item.dateRange ?? ""}
                onChange={(e) => update(sectionId, item.id, { dateRange: e.target.value })}
                onFocus={onFocus}
              />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <BulletList sectionId={sectionId} itemId={item.id} bullets={item.bullets} />
          </div>
        </>
      )}
    </div>
  );
}
