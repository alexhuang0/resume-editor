# resume-editor

Local web app for editing a Jake's-resume-style CV. Designed to round-trip a stable JSON artifact with Claude.ai for AI-assisted tailoring per job posting, then export to PDF (via browser print) and Markdown.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The app seeds a default variant on first run; everything persists to browser `localStorage`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production bundle to `dist/` |
| `npm run lint` | Oxlint |
| `npm run preview` | Serve the built `dist/` |

## Where to look next

- **[ONBOARDING.md](./ONBOARDING.md)** — design rationale, invariants, and the verification ritual. Read this if you're returning to the repo after time away.
- **[CLAUDE.md](./CLAUDE.md)** — architecture map written for Claude Code agents; also useful as a deeper code tour.

## Stack

Vite + React 18 + TypeScript, with `zustand` (state, persisted to `localStorage`), `@dnd-kit` (drag-to-reorder), `zod` (JSON import validation), and `react-hotkeys-hook` (keyboard shortcuts). No PDF library — PDF export is `window.print()` against a shared screen + `@media print` stylesheet.
