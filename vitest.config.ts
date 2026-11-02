import { defineConfig } from "vitest/config";

/**
 * A deliberately narrow test setup (design §7).
 *
 * ONBOARDING.md's "no automated test suite" stance still holds for everything
 * visual — PDF fidelity, drag-and-drop, ATS-parseability. It does not hold for
 * the pure modules whose silent failure corrupts what the user prints, so the
 * `include` list below is an allow-list of exactly those: the preview math, the
 * resolver, the migration, and the divergence detector. The store and exporter
 * globs are empty today and fill in as those modules grow tests.
 *
 * No `environment: "jsdom"`, no setup files, no component or snapshot tests. A
 * test that needs a DOM is out of scope and belongs in the manual ritual.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/components/Preview/**/*.test.ts",
      "src/components/Preview/**/*.test.tsx",
      "src/store/**/*.test.ts",
      "src/sync/**/*.test.ts",
      "src/exporters/**/*.test.ts",
      "src/utils/**/*.test.ts",
      "src/utils/**/*.test.tsx",
    ],
  },
});
