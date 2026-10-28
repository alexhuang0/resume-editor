import { useEffect, useMemo, useRef, useState } from "react";
import { bankIdsInUse } from "../../store/bankIdsInUse";
import { bankItemDisplayLabel } from "../../store/bankLabel";
import { useResumeStore } from "../../store/resumeStore";
import type { Section } from "../../store/schema";

type Props = { section: Section };

/**
 * "+ From bank" picker (9.3). Lists bank entries whose kind matches the
 * section and marks the ones already used somewhere in the active variant.
 * The mark is a hint only: an entry can be added again.
 */
export function BankPicker({ section }: Props) {
  const bank = useResumeStore((s) => s.bank);
  // Selects an existing object (or undefined), so the selector is
  // reference-stable. The derived Set is built in useMemo, not in the selector.
  const variant = useResumeStore((s) =>
    s.variants.find((v) => v.id === s.currentVariantId)
  );
  const addItemFromBank = useResumeStore((s) => s.addItemFromBank);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () => bank.filter((b) => b.kind === section.kind),
    [bank, section.kind]
  );
  const inUse = useMemo(() => bankIdsInUse(variant), [variant]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []
    );
    if (els.length === 0) return;
    e.preventDefault();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? i + 1 : i - 1;
    els[(next + els.length) % els.length].focus();
  };

  const pick = (bankId: string) => {
    addItemFromBank(section.id, bankId);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <span className="bank-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        className="btn small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        + From bank
      </button>
      {open && (
        <div
          className="bank-picker-menu"
          role="menu"
          aria-label={`Add ${section.kind} entry from bank`}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          {entries.length === 0 ? (
            <div className="bank-picker-empty">
              No {section.kind} entries in the bank.
            </div>
          ) : (
            entries.map((entry) => {
              const used = inUse.has(entry.id);
              return (
                <button
                  key={entry.id}
                  role="menuitem"
                  className={`bank-picker-item ${used ? "in-use" : ""}`}
                  onClick={() => pick(entry.id)}
                >
                  <span className="bank-picker-label">{bankItemDisplayLabel(entry)}</span>
                  {used && <span className="bank-picker-badge">✓ in use</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </span>
  );
}
