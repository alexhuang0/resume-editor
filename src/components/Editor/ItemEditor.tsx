import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { bulletRowActions } from "../../store/bulletRowActions";
import { isOrphaned, linkState, overlayHiddenBullets } from "../../store/resolve";
import {
  pushHiddenBulletsMessage,
  pushWarnsHiddenBullets,
} from "../../store/pushWarnsHiddenBullets";
import { useRawItem, useResumeStore } from "../../store/resumeStore";
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
  // `item` is the resolved view; the raw item carries the link state.
  const raw = useRawItem(sectionId, item.id);
  const update = useResumeStore((s) => s.updateItem);
  const toggle = useResumeStore((s) => s.toggleItemHidden);
  const remove = useResumeStore((s) => s.deleteItem);
  const dup = useResumeStore((s) => s.duplicateItem);
  const add = useResumeStore((s) => s.addItem);
  const insertItem = useResumeStore((s) => s.insertItem);
  const detach = useResumeStore((s) => s.detachItem);
  const resync = useResumeStore((s) => s.resyncItem);
  const pushItem = useResumeStore((s) => s.pushItemToBank);
  const promote = useResumeStore((s) => s.promoteItemToBank);
  const fork = useResumeStore((s) => s.forkItemToNewBankItem);
  const dropLink = useResumeStore((s) => s.dropItemLink);
  const setFocus = useUiStore((s) => s.setFocus);
  const collapsed = useUiStore((s) => !!s.collapsedItems[item.id]);
  const toggleCollapsed = useUiStore((s) => s.toggleItemCollapsed);
  const pushToast = useUiStore((s) => s.pushToast);
  const openInBank = useUiStore((s) => s.openInBank);
  const bankEntry = useResumeStore((s) =>
    raw?.link ? s.bank.find((b) => b.id === raw.link!.bankId) : undefined
  );

  // Safety net (design §4.2): a link whose bank entry is gone. Boolean
  // selector, so the row only re-renders when the answer flips.
  const orphaned = useResumeStore((s) =>
    raw ? isOrphaned(raw, s.bank) : false
  );

  // Inputs are always editable. A wording edit on a linked item auto-detaches
  // it in the store (withAutoDetach, Req 7.1), so no read-only state is needed.
  const isLinked = !!raw && linkState(raw) === "linked";

  // Linked item with its entry present: bullet ✕ hides, Duplicate is off, and
  // overlay-hidden bullets (absent from `item.bullets`) are listed for un-hiding.
  const bulletsLinked = bulletRowActions(raw, bankEntry).linked;
  const hiddenBullets =
    raw && bankEntry && bulletsLinked ? overlayHiddenBullets(raw, bankEntry) : [];

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const onFocus = () => setFocus({ kind: "item", sectionId, itemId: item.id });

  // Doubles as the toolbar's heading text and the chevron's accessible name, so
  // a collapsed item stays identifiable both on screen and to a screen reader
  // (3.1).
  const label = item.heading || (isSkills ? "Skill row" : "Item");

  const handleDelete = () => {
    const r = useResumeStore.getState();
    const variant = r.variants.find((v) => v.id === r.currentVariantId);
    const section = variant?.sections.find((s) => s.id === sectionId);
    const index = section?.items.findIndex((i) => i.id === item.id) ?? -1;
    // `item` is the resolved view; undo must restore the RAW item, or a linked
    // item would come back with the bank wording inlined (breaks 5.4).
    // `remove` returns the raw item it took out of the store.
    const snapshot = remove(sectionId, item.id);
    if (!snapshot) return;
    pushToast({
      message: isSkills ? "Skill row deleted" : "Item deleted",
      undo: () => {
        if (index >= 0) insertItem(sectionId, snapshot, index);
      },
    });
  };

  const handlePush = () => {
    // The warning lives here, not in the store action (task 7.3, design §5.7).
    // `item` is the resolved view; a detached item resolves to its own bullets.
    if (
      raw &&
      pushWarnsHiddenBullets(raw) &&
      !confirm(pushHiddenBulletsMessage(raw))
    ) {
      return;
    }
    pushItem(sectionId, item.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-link-state={raw ? linkState(raw) : undefined}
      className={`editor-row item ${item.hidden ? "hidden-node" : ""}`}
      onFocus={onFocus}
    >
      <div className="row-toolbar">
        <span className="drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
        <button
          className="btn small ghost"
          onClick={() => toggleCollapsed(item.id)}
          title={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        {raw && linkState(raw) === "linked" && (
          <span
            className="link-dot"
            role="img"
            aria-label="Linked to bank"
            title="Linked to bank"
          />
        )}
        {raw && linkState(raw) === "detached" && (
          <span
            className="detach-dot"
            role="img"
            aria-label="Detached from bank (local copy)"
            title="Detached from bank (local copy)"
          />
        )}
        <span className="row-title">{label}</span>
        {orphaned && (
          <span
            className="orphan-tag"
            title="The bank entry this item was linked to no longer exists"
          >
            Bank entry missing
          </span>
        )}
        {orphaned && isLinked && (
          <button
            className="btn small"
            title="Save this item's own wording as a new bank entry and link to it"
            onClick={() => fork(sectionId, item.id)}
          >
            Fork to bank
          </button>
        )}
        {orphaned && (
          <button
            className="btn small"
            title="Remove the broken link and keep this item as a local copy"
            onClick={() => dropLink(sectionId, item.id)}
          >
            Drop link
          </button>
        )}
        {isLinked && !orphaned && (
          <button
            className="btn small"
            title="This item is linked to the bank. Open it in the Bank panel to change the shared wording."
            onClick={() =>
              openInBank(
                bankEntry ? { kind: bankEntry.kind, id: bankEntry.id } : null
              )
            }
          >
            Edit in Bank
          </button>
        )}
        {isLinked && !orphaned && (
          <button
            className="btn small"
            title="Detach from bank: keep a local copy"
            onClick={() => detach(sectionId, item.id)}
          >
            Detach
          </button>
        )}
        {raw && linkState(raw) === "detached" && bankEntry && (
          <button
            className="btn small"
            title="Discard local wording and re-link to the bank"
            onClick={() => resync(sectionId, item.id)}
          >
            Resync
          </button>
        )}
        {raw && linkState(raw) === "detached" && bankEntry && (
          <button
            className="btn small"
            title="Overwrite the bank entry with this item's wording"
            onClick={handlePush}
          >
            Push to bank
          </button>
        )}
        {raw && linkState(raw) === "detached" && (
          <button
            className="btn small"
            title="Save this item as a new bank entry and link to it"
            onClick={() => fork(sectionId, item.id)}
          >
            Fork
          </button>
        )}
        {raw && linkState(raw) === "local" && (
          <button
            className="btn small"
            title="Save this item to the bank and link it"
            onClick={() => promote(sectionId, item.id)}
          >
            Add to bank ↑
          </button>
        )}
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

      {/* Collapsed hides the field grid and the bullets only (3.1). The toolbar
          above stays mounted, so the heading text, the drag handle and every
          row action keep working on a collapsed item. Nothing here touches the
          resume data, so the preview and the print output are unaffected (3.5). */}
      {!collapsed && (isSkills ? (
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
            {/* `item` is the resolved view, so bullets[0] is the bank bullet on
                a linked row (raw storage has none). updateBullet auto-detaches
                and edits the baked copy of that same bullet id. */}
            <input
              className="row-input"
              value={item.bullets[0]?.text ?? ""}
              onChange={(e) => {
                const { updateBullet, addBullet } = useResumeStore.getState();
                const bulletId = item.bullets[0]?.id;
                if (bulletId) {
                  updateBullet(sectionId, item.id, bulletId, e.target.value);
                } else {
                  // No bullet yet: create one and write the keystroke into it.
                  const id = addBullet(sectionId, item.id);
                  if (id) updateBullet(sectionId, item.id, id, e.target.value);
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
            <BulletList
              sectionId={sectionId}
              itemId={item.id}
              bullets={item.bullets}
              linked={bulletsLinked}
              hiddenBullets={hiddenBullets}
            />
          </div>
        </>
      ))}
    </div>
  );
}
