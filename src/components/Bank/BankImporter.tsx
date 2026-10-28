import { useMemo, useState } from "react";
import { useResumeStore } from "../../store/resumeStore";
import { useUiStore } from "../../store/uiStore";
import { projectItemsToImport } from "../../store/importProjection";
import {
  importedToastMessage,
  importerSections,
} from "../../store/importerView";

/**
 * The guided bank bootstrap (task 10.3, Req 11.1): pick a source variant →
 * pick sections → preview the entries that will be created → confirm. It is the
 * Bank's whole-empty state, and also reachable from a panel-bar button once the
 * bank is non-empty (the always-available seam task 10.4 builds on).
 *
 * The component is deliberately thin: WHICH items qualify and WHAT the preview
 * shows come entirely from `projectItemsToImport` (10.2) and the pure
 * `importerView` helpers, so this UI can never disagree with the apply step
 * `importItemsToBank` (10.1) about the set.
 */
export function BankImporter({ onDone }: { onDone: () => void }) {
  const variants = useResumeStore((s) => s.variants);
  const currentVariantId = useResumeStore((s) => s.currentVariantId);
  const importItemsToBank = useResumeStore((s) => s.importItemsToBank);
  const pushToast = useUiStore((s) => s.pushToast);

  // Default to the current variant (11.1): it is the one the user is editing.
  const [variantId, setVariantId] = useState(currentVariantId);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];

  const sections = useMemo(() => importerSections(variant), [variant]);

  // Section selection, defaulting to every section that has something to
  // import so the common "import it all" case is one click to confirm.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.importableCount > 0).map((s) => s.id))
  );

  const onVariantChange = (nextId: string) => {
    setVariantId(nextId);
    const next = variants.find((v) => v.id === nextId);
    // Reset the selection to the new variant's importable sections — section
    // ids do not carry across variants.
    setSelectedIds(
      new Set(
        importerSections(next)
          .filter((s) => s.importableCount > 0)
          .map((s) => s.id)
      )
    );
  };

  const toggleSection = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedSectionIds = useMemo(
    () => sections.filter((s) => selectedIds.has(s.id)).map((s) => s.id),
    [sections, selectedIds]
  );

  // The preview is the projection, verbatim — one source of truth with apply.
  const preview = useMemo(
    () => projectItemsToImport(variant, selectedSectionIds),
    [variant, selectedSectionIds]
  );

  const confirm = () => {
    if (!variant || preview.length === 0) return;
    const created = importItemsToBank(variant.id, selectedSectionIds);
    pushToast({ message: importedToastMessage(created.length) });
    onDone();
  };

  if (!variant) {
    return <div className="bank-empty">No variants to import from yet.</div>;
  }

  return (
    <div className="bank-importer">
      <p className="bank-importer-intro">
        Import items from a variant to start your bank. Linked items are skipped.
      </p>

      <label className="bank-importer-step">
        <span className="field-label">Source variant</span>
        <select
          className="sidebar-mode"
          value={variantId}
          onChange={(e) => onVariantChange(e.target.value)}
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      <div className="bank-importer-step">
        <span className="field-label">Sections</span>
        {sections.length === 0 ? (
          <div className="bank-empty">This variant has no sections.</div>
        ) : (
          <ul className="bank-importer-sections">
            {sections.map((s) => (
              <li key={s.id}>
                <label
                  className={`bank-importer-section ${
                    s.importableCount === 0 ? "muted" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    disabled={s.importableCount === 0}
                    onChange={() => toggleSection(s.id)}
                  />
                  <span className="bank-importer-section-title">{s.title}</span>
                  <span className="bank-importer-section-count">
                    {s.importableCount}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bank-importer-step">
        <span className="field-label">
          Will create {preview.length}{" "}
          {preview.length === 1 ? "entry" : "entries"}
        </span>
        {preview.length === 0 ? (
          <div className="bank-empty">
            Nothing to import from the selected sections.
          </div>
        ) : (
          <ul className="bank-importer-preview">
            {preview.map((entry) => (
              <li key={`${entry.sectionId}\u0000${entry.itemId}`}>
                <span className="bank-importer-preview-label">{entry.label}</span>
                <span className="bank-importer-preview-kind">{entry.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bank-importer-actions">
        <button className="btn small" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn small primary"
          disabled={preview.length === 0}
          onClick={confirm}
        >
          Import {preview.length > 0 ? preview.length : ""}
        </button>
      </div>
    </div>
  );
}
