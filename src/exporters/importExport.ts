import type { Library, Resume } from "../store/schema";
import { CURRENT_SCHEMA_VERSION, LibrarySchema, ResumeSchema, newId } from "../store/schema";

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

export function exportResumeAsJsonFile(resume: Resume): void {
  download(
    `${safeFilename(resume.name)}.resume.json`,
    JSON.stringify(resume, null, 2)
  );
}

export function exportLibraryAsJsonFile(variants: Resume[]): void {
  const lib: Library = { schemaVersion: CURRENT_SCHEMA_VERSION, variants };
  download(`resume-library.json`, JSON.stringify(lib, null, 2));
}

export function exportMarkdownFile(resume: Resume, markdown: string): void {
  download(
    `${safeFilename(resume.name)}.md`,
    markdown,
    "text/markdown;charset=utf-8"
  );
}

function migrateImportedResumeV1toV2(v: unknown): unknown {
  const r = v as Record<string, unknown>;
  const header = r.header as Record<string, unknown> | undefined;
  if (!header || Array.isArray(header.fields)) {
    return { ...r, schemaVersion: 2 };
  }
  const fields: { id: string; label: string; url?: string }[] = [];
  if (typeof header.location === "string" && header.location)
    fields.push({ id: newId("hf"), label: header.location });
  if (typeof header.phone === "string" && header.phone)
    fields.push({ id: newId("hf"), label: header.phone });
  if (typeof header.email === "string" && header.email)
    fields.push({ id: newId("hf"), label: header.email, url: `mailto:${header.email}` });
  const links = Array.isArray(header.links)
    ? (header.links as { label?: string; url?: string }[])
    : [];
  for (const l of links) {
    if (!l.label && !l.url) continue;
    fields.push({ id: newId("hf"), label: l.label ?? l.url ?? "", url: l.url });
  }
  return { ...r, schemaVersion: 2, header: { fullName: header.fullName ?? "", fields } };
}

function migrateImportToV2(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion === 1 && Array.isArray(d.variants)) {
    return {
      ...d,
      schemaVersion: 2,
      variants: (d.variants as unknown[]).map(migrateImportedResumeV1toV2),
    };
  }
  if (d.schemaVersion === 1 && d.header) {
    return migrateImportedResumeV1toV2(d);
  }
  return data;
}

export type ParsedImport =
  | { kind: "resume"; resume: Resume }
  | { kind: "library"; variants: Resume[] }
  | { kind: "error"; messages: string[] };

export function parseImport(raw: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { kind: "error", messages: [`Invalid JSON: ${(e as Error).message}`] };
  }

  data = migrateImportToV2(data);

  const libParsed = LibrarySchema.safeParse(data);
  if (libParsed.success) {
    return {
      kind: "library",
      variants: libParsed.data.variants.map((v) => ({
        ...v,
        id: v.id || newId("r"),
      })),
    };
  }
  const resumeParsed = ResumeSchema.safeParse(data);
  if (resumeParsed.success) {
    return {
      kind: "resume",
      resume: { ...resumeParsed.data, id: resumeParsed.data.id || newId("r") },
    };
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
