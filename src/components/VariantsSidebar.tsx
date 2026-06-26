import { useState } from "react";
import { useResumeStore } from "../store/resumeStore";
import { useUiStore } from "../store/uiStore";
import {
  exportLibraryAsJsonFile,
  exportResumeAsJsonFile,
  parseImport,
  pickJsonFile,
  readFileAsText,
} from "../exporters/importExport";

export function VariantsSidebar() {
  const variants = useResumeStore((s) => s.variants);
  const currentId = useResumeStore((s) => s.currentVariantId);
  const setCurrent = useResumeStore((s) => s.setCurrentVariant);
  const createVariant = useResumeStore((s) => s.createVariant);
  const duplicate = useResumeStore((s) => s.duplicateVariant);
  const deleteVariant = useResumeStore((s) => s.deleteVariant);
  const rename = useResumeStore((s) => s.renameVariant);
  const replaceVariant = useResumeStore((s) => s.replaceVariant);
  const addVariant = useResumeStore((s) => s.addVariant);
  const replaceLibrary = useResumeStore((s) => s.replaceLibrary);
  const pushToast = useUiStore((s) => s.pushToast);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const current = variants.find((v) => v.id === currentId);

  const importVariantOrLibrary = async () => {
    const file = await pickJsonFile();
    if (!file) return;
    const raw = await readFileAsText(file);
    const parsed = parseImport(raw);
    if (parsed.kind === "error") {
      alert(`Import failed:\n${parsed.messages.join("\n")}`);
      return;
    }
    if (parsed.kind === "library") {
      if (
        confirm(
          `Replace your entire library with ${parsed.variants.length} variants from this file? Current library will be discarded.`
        )
      ) {
        replaceLibrary(parsed.variants);
        pushToast({ message: `Imported ${parsed.variants.length} variants` });
      }
      return;
    }
    // resume
    const choice = window.prompt(
      `Import "${parsed.resume.name}"\n\nType 'o' to OVERWRITE the active variant, or 'n' to add as NEW variant.\n\nLeave blank to cancel.`,
      "n"
    );
    if (!choice) return;
    if (choice.toLowerCase().startsWith("o") && current) {
      replaceVariant(current.id, parsed.resume);
      pushToast({ message: `Overwrote "${current.name}"` });
    } else {
      addVariant(parsed.resume);
      pushToast({ message: `Added "${parsed.resume.name}"` });
    }
  };

  const exportCurrentJson = () => {
    if (current) exportResumeAsJsonFile(current);
  };

  const exportAll = () => exportLibraryAsJsonFile(variants);

  const submitRename = (id: string) => {
    const name = draftName.trim();
    if (name) rename(id, name);
    setRenaming(null);
    setDraftName("");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Resume variants</span>
        <button
          className="btn small primary"
          onClick={() => createVariant("Untitled")}
          title="New variant"
        >
          + New
        </button>
      </div>
      <div className="sidebar-list">
        {variants.map((v) => (
          <div
            key={v.id}
            className={`variant-row ${v.id === currentId ? "active" : ""}`}
            onClick={() => v.id !== renaming && setCurrent(v.id)}
            onDoubleClick={() => {
              setRenaming(v.id);
              setDraftName(v.name);
            }}
          >
            {renaming === v.id ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => submitRename(v.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(v.id);
                  if (e.key === "Escape") {
                    setRenaming(null);
                    setDraftName("");
                  }
                }}
              />
            ) : (
              <span className="variant-name" title={v.name}>
                {v.name}
              </span>
            )}
            {v.id === currentId && variants.length > 1 && (
              <button
                className="btn small ghost danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete variant "${v.name}"? This can't be undone.`)) {
                    deleteVariant(v.id);
                  }
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar-actions">
        <div className="sidebar-actions-row">
          <button
            className="btn small"
            style={{ flex: 1 }}
            onClick={() => current && duplicate(current.id)}
          >
            Duplicate
          </button>
          <button
            className="btn small"
            style={{ flex: 1 }}
            onClick={() => {
              if (!current) return;
              setRenaming(current.id);
              setDraftName(current.name);
            }}
          >
            Rename
          </button>
        </div>
        <div className="sidebar-actions-row">
          <button className="btn small" style={{ flex: 1 }} onClick={exportCurrentJson}>
            Export JSON
          </button>
          <button className="btn small" style={{ flex: 1 }} onClick={importVariantOrLibrary}>
            Import JSON
          </button>
        </div>
        <button className="btn small" onClick={exportAll}>
          Export all (backup)
        </button>
      </div>
    </aside>
  );
}
