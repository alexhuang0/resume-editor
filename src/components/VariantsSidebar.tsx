import { useState } from "react";
import { useResumeStore } from "../store/resumeStore";
import { useUiStore, type SidebarMode } from "../store/uiStore";
import { BankPanel } from "./Bank/BankPanel";
import {
  exportLibraryAsJsonFile,
  exportResumeAsJsonFile,
  parseImport,
  pickJsonFile,
  readFileAsText,
} from "../exporters/importExport";
import { withDivergence } from "../store/reconcile";
import { buildTailoringPrompt } from "../store/tailoringPrompt";

export function VariantsSidebar() {
  const variants = useResumeStore((s) => s.variants);
  const bank = useResumeStore((s) => s.bank);
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
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const current = variants.find((v) => v.id === currentId);

  const importVariantOrLibrary = async () => {
    const file = await pickJsonFile();
    if (!file) return;
    const raw = await readFileAsText(file);
    // The store's bank is passed as a thunk that only a single-variant import
    // calls (reconciled against the bank you have now). A library import brings
    // its own bank and is reconciled against that, never this one.
    const parsed = parseImport(raw, {
      getCurrentBank: () => useResumeStore.getState().bank,
    });
    if (parsed.kind === "error") {
      alert(`Import failed:\n${parsed.messages.join("\n")}`);
      return;
    }
    if (parsed.kind === "library") {
      if (
        confirm(
          `Replace your entire library with ${parsed.variants.length} variants and ${parsed.bank.length} bank items from this file? Your current variants and bank will be discarded.`
        )
      ) {
        // Variants and the file's bank go in together; the old bank is replaced.
        replaceLibrary(parsed.variants, parsed.bank);
        pushToast({
          message: withDivergence(`Imported ${parsed.variants.length} variants`, parsed.diverged),
        });
      }
      return;
    }
    // resume: a single variant never replaces the store's bank.
    const choice = window.prompt(
      `Import "${parsed.resume.name}"\n\nType 'o' to OVERWRITE the active variant, or 'n' to add as NEW variant.\n\nLeave blank to cancel.`,
      "n"
    );
    if (!choice) return;
    if (choice.toLowerCase().startsWith("o") && current) {
      replaceVariant(current.id, parsed.resume);
      pushToast({
        message: withDivergence(`Overwrote "${current.name}"`, parsed.diverged),
      });
    } else {
      addVariant(parsed.resume);
      pushToast({
        message: withDivergence(`Added "${parsed.resume.name}"`, parsed.diverged),
      });
    }
  };

  const exportCurrentJson = () => {
    if (current) exportResumeAsJsonFile(current, bank);
  };

  const exportAll = () => exportLibraryAsJsonFile(variants, bank);

  const copyTailoringPrompt = async () => {
    if (!current) return;
    const text = buildTailoringPrompt(current, bank);
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ message: "Tailoring prompt copied" });
    } catch {
      // Clipboard can be unavailable (no permission, insecure context, older
      // browser). Surface it rather than letting the rejection go unhandled.
      pushToast({ message: "Couldn't copy to clipboard" });
    }
  };

  const submitRename = (id: string) => {
    const name = draftName.trim();
    if (name) rename(id, name);
    setRenaming(null);
    setDraftName("");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <select
          className="sidebar-mode"
          aria-label="Sidebar view"
          value={sidebarMode}
          onChange={(e) => setSidebarMode(e.target.value as SidebarMode)}
        >
          <option value="variants">Variants</option>
          <option value="bank">Bank</option>
        </select>
        {sidebarMode === "variants" && (
          <button
            className="btn small primary"
            onClick={() => createVariant("Untitled")}
            title="New variant"
          >
            + New
          </button>
        )}
      </div>
      {sidebarMode === "bank" ? (
        <BankPanel />
      ) : (
        <>
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
          <button
            className="btn small"
            onClick={copyTailoringPrompt}
            disabled={!current}
            title="Copy the tailoring rules plus this variant's JSON to the clipboard"
          >
            Copy tailoring prompt
          </button>
          <button className="btn small" onClick={exportAll}>
            Export all (backup)
          </button>
        </div>
        </>
      )}
    </aside>
  );
}
