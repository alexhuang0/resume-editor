import type { Library, Resume } from "../store/schema";
import { LibrarySchema, ResumeSchema, newId } from "../store/schema";

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
  const lib: Library = { schemaVersion: 1, variants };
  download(`resume-library.json`, JSON.stringify(lib, null, 2));
}

export function exportMarkdownFile(resume: Resume, markdown: string): void {
  download(
    `${safeFilename(resume.name)}.md`,
    markdown,
    "text/markdown;charset=utf-8"
  );
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
