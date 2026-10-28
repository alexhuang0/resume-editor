import type { BankItem, Item, Library, Resume } from "../store/schema";
import { CURRENT_SCHEMA_VERSION, LibrarySchema, ResumeSchema, newId } from "../store/schema";
import { migrateResumeV1toV2, migrateResumeV2toV3 } from "../store/migrations";
import { resolveResume } from "../store/resolve";
import { reconcileVariant as reconcileVariantAgainstBank } from "../store/reconcile";
import type { ReconcileVariantResult } from "../store/reconcile";

function safeFilename(name: string): string {
  return (
    name.trim().replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") ||
    "resume"
  );
}

function download(filename: string, contents: string, mime = "application/json") {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The exact bytes `exportResumeAsJsonFile` writes to disk, split out from the
 * `download` call so the payload can be asserted on without a DOM.
 *
 * Keeping this separate is what lets `collapseIsolation.test.ts` pin the
 * UI-only contract (3.4) against the real serializer rather than against a
 * re-implementation of it that could drift.
 */
export function resumeJsonPayload(resume: Resume, bank: BankItem[] = []): string {
  // Single-variant export is a self-contained artifact: linked items are
  // inlined from the bank so the file is readable without the library.
  // With nothing linked, resolveResume returns the same object, so the output
  // is byte-identical to serializing the variant directly.
  // `orphaned` is a runtime-only UI flag added by the resolver; it stays out
  // of the artifact. `link`, `hiddenBulletIds` and `bulletOrder` ride along
  // as inert metadata so the import side can see the overlay.
  return JSON.stringify(stripOrphanFlags(resolveResume(resume, bank)), null, 2);
}

/**
 * Remove the resolver's runtime-only `orphaned` flag from every item (design
 * §4.7). It is a UI flag, not part of the JSON artifact contract. Everything
 * else on the item, including `link`, `hiddenBulletIds` and `bulletOrder`, is
 * left alone. Pure: nothing is mutated, and only the sections/items that carry
 * the flag are rebuilt. When none do, the input is returned as-is, so a
 * variant without orphans serializes identically to the variant itself.
 */
export function stripOrphanFlags(resume: Resume): Resume {
  let changed = false;
  const sections = resume.sections.map((section) => {
    let sectionChanged = false;
    const items = section.items.map((item) => {
      if (!("orphaned" in item)) return item;
      sectionChanged = true;
      const { orphaned: _orphaned, ...rest } = item as Item & { orphaned?: boolean };
      return rest as Item;
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, items };
  });
  return changed ? { ...resume, sections } : resume;
}

/** The exact bytes `exportLibraryAsJsonFile` writes. See `resumeJsonPayload`. */
export function libraryJsonPayload(variants: Resume[], bank: BankItem[]): string {
  const lib: Library = { schemaVersion: CURRENT_SCHEMA_VERSION, variants, bank };
  return JSON.stringify(lib, null, 2);
}

/**
 * Takes the RAW variant plus the bank; resolution happens once, inside
 * `resumeJsonPayload`. Callers must not pre-resolve.
 */
export function exportResumeAsJsonFile(variant: Resume, bank: BankItem[]): void {
  download(
    `${safeFilename(variant.name)}.resume.json`,
    resumeJsonPayload(variant, bank)
  );
}

export function exportLibraryAsJsonFile(variants: Resume[], bank: BankItem[]): void {
  download(`resume-library.json`, libraryJsonPayload(variants, bank));
}

export function exportMarkdownFile(resume: Resume, markdown: string): void {
  download(
    `${safeFilename(resume.name)}.md`,
    markdown,
    "text/markdown;charset=utf-8"
  );
}

/** v1 -> v2 for a single resume or a library. Output is schemaVersion 2. */
function migrateImportV1toV2(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== 1) return data;
  if (Array.isArray(d.variants)) {
    return {
      ...d,
      schemaVersion: 2,
      variants: (d.variants as unknown[]).map(migrateResumeV1toV2),
    };
  }
  if (d.header) return migrateResumeV1toV2(d);
  return data;
}

/** v2 -> v3 for a single resume or a library. Output is schemaVersion 3. */
function migrateImportV2toV3(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== 2) return data;
  if (Array.isArray(d.variants)) {
    return {
      ...d,
      schemaVersion: 3,
      variants: (d.variants as unknown[]).map(migrateResumeV2toV3),
      bank: d.bank ?? [],
    };
  }
  if (d.header) return migrateResumeV2toV3(d);
  return data;
}

/** Chains v1 -> v2 -> v3. v3 (and anything unrecognised) passes through unchanged. */
function migrateImport(data: unknown): unknown {
  return migrateImportV2toV3(migrateImportV1toV2(data));
}

/**
 * What an import hands back to the caller (design §4.7).
 *
 * The two shapes encode which bank an import is reconciled against, and what
 * the caller may do to the store's bank afterwards:
 *
 * - `library` carries the file's own `bank`. Its variants were reconciled
 *   against THAT bank, never the store's. The caller replaces the store's
 *   variants and bank together: `replaceLibrary(variants, bank)`. Taking one
 *   without the other leaves every link dangling (a linked item stores no
 *   wording, so it would render blank).
 * `diverged` is the number of linked items, across every variant in the file,
 * whose wording differed from the bank and so were kept and detached (Req 10.3,
 * 10.4). The caller turns a non-zero count into the review toast.
 *
 * - `resume` has no bank, because a single-variant file does not bring one.
 *   Its resume was reconciled against the store's CURRENT bank, and the
 *   caller must not touch the store's bank: `replaceVariant` / `addVariant`
 *   only.
 */
export type ParsedImport =
  | { kind: "resume"; resume: Resume; diverged: number }
  | { kind: "library"; variants: Resume[]; bank: BankItem[]; diverged: number }
  | { kind: "error"; messages: string[] };

/**
 * Per-variant reconciliation against a bank, keyed by id. Returns the
 * reconciled variant and how many of its items diverged. Which map arrives
 * here is the whole point of task 9.2: the file's bank for a library import,
 * the store's current bank for a single-variant import. Production uses
 * `reconcileVariant` from store/reconcile (task 9.5).
 */
export type VariantReconciler = (
  variant: Resume,
  bankById: Map<string, BankItem>
) => ReconcileVariantResult;

export type ParseImportOptions = {
  /**
   * The store's current bank, as a thunk. ONLY the single-resume branch calls
   * it. A library import brings its own bank and never invokes it, so nothing
   * on that path can read, or accidentally prefer, the store's bank. The
   * thunk (rather than a value) also means the call site reads the store at
   * parse time instead of closing over a bank that went stale during the file
   * pick. Omitted means an empty bank, which orphans every link in a
   * single-variant file (content is kept, see design §4.7).
   */
  getCurrentBank?: () => readonly BankItem[];
  /** Test seam for the reconciliation wiring; production uses the default. */
  reconcileVariant?: VariantReconciler;
};

const indexBank = (bank: readonly BankItem[]): Map<string, BankItem> =>
  new Map(bank.map((b) => [b.id, b]));

export function parseImport(raw: string, options: ParseImportOptions = {}): ParsedImport {
  const { getCurrentBank = () => [], reconcileVariant = reconcileVariantAgainstBank } = options;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { kind: "error", messages: [`Invalid JSON: ${(e as Error).message}`] };
  }

  data = migrateImport(data);

  const libParsed = LibrarySchema.safeParse(data);
  if (libParsed.success) {
    // Library import: the file's own bank is the reconciliation source, and is
    // the same bank handed back for `replaceLibrary`. getCurrentBank is not
    // called here.
    const bank = libParsed.data.bank;
    const importedBankById = indexBank(bank);
    let diverged = 0;
    const variants = libParsed.data.variants.map((v) => {
      const r = reconcileVariant({ ...v, id: v.id || newId("r") }, importedBankById);
      diverged += r.diverged;
      return r.variant;
    });
    return { kind: "library", variants, bank, diverged };
  }
  const resumeParsed = ResumeSchema.safeParse(data);
  if (resumeParsed.success) {
    // Single-variant import: no bank in the file, so reconcile against the
    // store's current bank. The result carries no bank by design.
    const currentBankById = indexBank(getCurrentBank());
    const r = reconcileVariant(
      { ...resumeParsed.data, id: resumeParsed.data.id || newId("r") },
      currentBankById
    );
    return { kind: "resume", resume: r.variant, diverged: r.diverged };
  }
  const issues = resumeParsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`);
  return {
    kind: "error",
    messages: ["Not a valid Resume or Library file.", ...issues],
  };
}

export async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}

export function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const f = input.files?.[0] ?? null;
      resolve(f);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
