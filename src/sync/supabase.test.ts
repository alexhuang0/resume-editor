import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Config resolution degrades to Local_Only_Mode (task 1.3).
 *
 * `src/sync/supabase.ts` resolves config at module-load time from
 * `import.meta.env`. To exercise each config case we stub the env, reset the
 * module registry, and dynamically re-import so the module re-evaluates with
 * fresh env per case.
 *
 * _Requirements: 8.1, 8.2, 12.9_
 */

async function loadModule() {
  vi.resetModules();
  return import("./supabase");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("supabase config resolution", () => {
  it("degrades to Local_Only_Mode when env vars are unset (Req 8.1)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const { isSyncConfigured, supabase } = await loadModule();

    expect(isSyncConfigured).toBe(false);
    expect(supabase).toBeNull();
  });

  it("degrades to Local_Only_Mode for a non-https URL (Req 8.2)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://foo");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

    const { isSyncConfigured, supabase } = await loadModule();

    expect(isSyncConfigured).toBe(false);
    expect(supabase).toBeNull();
  });

  it("degrades to Local_Only_Mode for an unparseable URL (Req 8.2)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "not a url");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

    const { isSyncConfigured, supabase } = await loadModule();

    expect(isSyncConfigured).toBe(false);
    expect(supabase).toBeNull();
  });
});
