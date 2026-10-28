import type { BankItem, HeaderField, Resume } from "./schema";
import { newId } from "./schema";

/**
 * Per-resume schema migrations. Shared by `parseImport` (JSON files) and the
 * zustand persist `migrate` (localStorage) so the two upgrade paths cannot drift.
 *
 * Each step takes a resume of version N and returns a resume of version N+1.
 * Chain them: v1 -> v2 -> v3.
 */

/** v1 -> v2: flat header (location/phone/email/links) becomes `header.fields`. */
export function migrateResumeV1toV2(v: unknown): unknown {
  const r = v as Record<string, unknown>;
  const header = r.header as Record<string, unknown> | undefined;
  if (!header || Array.isArray(header.fields)) {
    return { ...r, schemaVersion: 2 };
  }
  const fields: HeaderField[] = [];
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

/**
 * v2 -> v3: sets `schemaVersion: 3` and rewrites nothing else. A v2 item has no
 * `link`, so the resolver renders it from its own fields exactly as before.
 */
export function migrateResumeV2toV3(v: unknown): unknown {
  return { ...(v as object), schemaVersion: 3 };
}

/** The persisted library slice, as the zustand store saves it. */
export type PersistedLibrary = {
  variants: Resume[];
  currentVariantId: string;
  bank: BankItem[];
};

/**
 * Upgrades a persisted (localStorage) library state from `fromVersion` to the
 * current one. This is the body of the zustand persist `migrate`, kept here as
 * a pure function so it can be tested without a store or a DOM.
 *
 * Chains v1 -> v2 -> v3 in one pass. Pre-bank states (v1, v2, and any v3 state
 * persisted without a `bank` key) get `bank: []`.
 */
export function migratePersistedLibrary(
  persisted: unknown,
  fromVersion: number
): PersistedLibrary {
  let state = persisted as {
    variants: unknown[];
    currentVariantId: string;
    bank?: BankItem[];
  };
  if (fromVersion <= 1) {
    state = { ...state, variants: state.variants.map(migrateResumeV1toV2) };
  }
  if (fromVersion <= 2) {
    state = { ...state, variants: state.variants.map(migrateResumeV2toV3) };
  }
  return { ...state, bank: state.bank ?? [] } as PersistedLibrary;
}
