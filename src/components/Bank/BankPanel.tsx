import { useEffect, useState } from "react";
import { useResumeStore } from "../../store/resumeStore";
import type { BankItem, SectionKind } from "../../store/schema";
import { bankItemDisplayLabel } from "../../store/bankLabel";
import { useUiStore } from "../../store/uiStore";
import { BankImporter } from "./BankImporter";

const KINDS: { kind: SectionKind; label: string }[] = [
  { kind: "experience", label: "Experience" },
  { kind: "education", label: "Education" },
  { kind: "projects", label: "Projects" },
  { kind: "skills", label: "Skills" },
  { kind: "custom", label: "Custom" },
];

/**
 * Bank CRUD, rendered inside the Variants pane (9.1, design §4.5). The selected
 * kind and the open entry are panel-local state: nothing here is persisted and
 * nothing touches a resume variant. The sidebar is already hidden at print via
 * `.pane-sidebar`, so no print rules are needed.
 */
export function BankPanel() {
  const bank = useResumeStore((s) => s.bank);
  const addBankItem = useResumeStore((s) => s.addBankItem);
  const request = useUiStore((s) => s.bankSelection);
  const clearRequest = useUiStore((s) => s.clearBankSelection);
  const [kind, setKind] = useState<SectionKind>("experience");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The guided importer (10.3). It opens automatically as the whole-bank empty
  // state, and stays reachable from the panel bar once the bank is non-empty —
  // the always-available entry point task 10.4 builds its per-section polish on.
  const [importing, setImporting] = useState(false);
  const bankIsEmpty = bank.length === 0;

  // "Edit in Bank" on a linked item asks for one entry to be opened. Consume
  // the request so it does not re-apply on a later mount.
  useEffect(() => {
    if (!request) return;
    setKind(request.kind);
    setSelectedId(request.id);
    clearRequest();
  }, [request, clearRequest]);

  const entries = bank.filter((b) => b.kind === kind);
  const selected = entries.find((b) => b.id === selectedId) ?? null;

  const onKindChange = (next: SectionKind) => {
    setKind(next);
    setSelectedId(null);
  };

  // The importer owns the panel while it is open (empty-bank bootstrap or an
  // explicit run from the panel bar): it is a full-panel flow, not an inline
  // row, so the kind switcher and entry list step aside.
  if (importing || bankIsEmpty) {
    return (
      <div className="bank-panel">
        <div className="bank-panel-bar">
          <span className="bank-panel-title">Import to bank</span>
          {!bankIsEmpty && (
            <button className="btn small" onClick={() => setImporting(false)}>
              Back
            </button>
          )}
        </div>
        <div className="bank-panel-body">
          <BankImporter onDone={() => setImporting(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="bank-panel">
      <div className="bank-panel-bar">
        <select
          className="sidebar-mode"
          aria-label="Section kind"
          value={kind}
          onChange={(e) => onKindChange(e.target.value as SectionKind)}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <div className="bank-panel-bar-actions">
          <button
            className="btn small"
            title="Import items from a variant"
            onClick={() => setImporting(true)}
          >
            ↡ Import
          </button>
          <button
            className="btn small primary"
            title="New bank entry"
            onClick={() => setSelectedId(addBankItem(kind))}
          >
            + New
          </button>
        </div>
      </div>

      <div className="bank-panel-body">
        {entries.length === 0 ? (
          <div className="bank-empty">No {kind} entries yet.</div>
        ) : (
          <ul className="bank-list">
            {entries.map((b) => (
              <li key={b.id}>
                <button
                  className={`variant-row bank-entry ${b.id === selectedId ? "active" : ""}`}
                  aria-pressed={b.id === selectedId}
                  onClick={() => setSelectedId(b.id === selectedId ? null : b.id)}
                >
                  <span className="variant-name" title={bankItemDisplayLabel(b)}>
                    {bankItemDisplayLabel(b)}
                  </span>
                </button>
                {b.id === selectedId && selected && (
                  <BankItemEditor
                    item={selected}
                    onDeleted={() => setSelectedId(null)}
                    onDuplicated={setSelectedId}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type EditorProps = {
  item: BankItem;
  onDeleted: () => void;
  onDuplicated: (newId: string) => void;
};

function BankItemEditor({ item, onDeleted, onDuplicated }: EditorProps) {
  const update = useResumeStore((s) => s.updateBankItem);
  const rename = useResumeStore((s) => s.renameBankItemLabel);
  const remove = useResumeStore((s) => s.deleteBankItem);
  const duplicate = useResumeStore((s) => s.duplicateBankItem);
  const isSkills = item.kind === "skills";

  const handleDelete = () => {
    if (
      !confirm(
        `Delete bank entry "${bankItemDisplayLabel(item)}"? Items in variants that use it will keep their content as local copies.`
      )
    ) {
      return;
    }
    remove(item.id); // the store pushes the undo toast
    onDeleted();
  };

  const handleDuplicate = () => {
    const id = duplicate(item.id);
    if (id) onDuplicated(id);
  };

  const field = (
    name: string,
    value: string | undefined,
    onChange: (v: string) => void
  ) => (
    <div>
      <div className="field-label">{name}</div>
      <input
        className="row-input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <div className="editor-row item bank-editor">
      <div className="row-toolbar">
        <span className="row-title">Entry</span>
        <button className="btn small" title="Duplicate" onClick={handleDuplicate}>
          ⎘
        </button>
        <button className="btn small danger" title="Delete" onClick={handleDelete}>
          ✕
        </button>
      </div>

      <div className="field-grid">
        {field("Label", item.label, (v) => rename(item.id, v))}
        {isSkills ? (
          <>
            {field("Category", item.heading, (v) => update(item.id, { heading: v }))}
            <SkillsItemsField item={item} />
          </>
        ) : (
          <>
            {field("Heading", item.heading, (v) => update(item.id, { heading: v }))}
            {field("Subheading", item.subheading, (v) => update(item.id, { subheading: v }))}
            {field("Location", item.location, (v) => update(item.id, { location: v }))}
            {field("Date range", item.dateRange, (v) => update(item.id, { dateRange: v }))}
          </>
        )}
      </div>

      {!isSkills && (
        <div style={{ marginTop: 8 }}>
          <BankBulletList bankId={item.id} bullets={item.bullets} />
        </div>
      )}
    </div>
  );
}

/** Skills convention: first bullet holds the comma-separated items. */
function SkillsItemsField({ item }: { item: BankItem }) {
  const addBullet = useResumeStore((s) => s.addBankBullet);
  const updateBullet = useResumeStore((s) => s.updateBankBullet);
  const first = item.bullets[0];

  return (
    <div>
      <div className="field-label">Items (comma separated)</div>
      <input
        className="row-input"
        value={first?.text ?? ""}
        onChange={(e) => {
          const id = first?.id ?? addBullet(item.id);
          if (id) updateBullet(item.id, id, e.target.value);
        }}
      />
    </div>
  );
}

function BankBulletList({ bankId, bullets }: { bankId: string; bullets: BankItem["bullets"] }) {
  const add = useResumeStore((s) => s.addBankBullet);
  const update = useResumeStore((s) => s.updateBankBullet);
  const remove = useResumeStore((s) => s.deleteBankBullet);
  const reorder = useResumeStore((s) => s.reorderBankBullets);

  // Up/down buttons rather than drag: the pane is narrow and buttons are
  // keyboard accessible.
  const move = (index: number, delta: -1 | 1) => {
    const ids = bullets.map((b) => b.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    reorder(bankId, ids);
  };

  return (
    <>
      <ul className="bullets-list">
        {bullets.map((b, i) => (
          <li key={b.id} className="editor-row bullet">
            <textarea
              className="bullet-text"
              value={b.text}
              rows={1}
              placeholder="Bullet text"
              onChange={(e) => update(bankId, b.id, e.target.value)}
            />
            <button
              className="btn small"
              title="Move up"
              aria-label="Move bullet up"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              className="btn small"
              title="Move down"
              aria-label="Move bullet down"
              disabled={i === bullets.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              className="btn small"
              title="Insert below"
              aria-label="Insert bullet below"
              onClick={() => add(bankId, b.id)}
            >
              +
            </button>
            <button
              className="btn small danger"
              title="Delete"
              aria-label="Delete bullet"
              onClick={() => remove(bankId, b.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button className="btn small" style={{ marginTop: 6 }} onClick={() => add(bankId)}>
        + Add bullet
      </button>
    </>
  );
}
