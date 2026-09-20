# Kaalgeplukt 🦆

A Dutch net-salary calculator for the cases most tools skip: a **13th month paid
out monthly**, **vakantiegeld paid out monthly**, a **pension premium deducted
before tax**, **tax-free allowances** (thuiswerkvergoeding and the like), and
life **after the 30% ruling**.

*Kaalgeplukt* — "plucked bare" — is what the taxman does to your gross. This shows
how many feathers you keep.

It computes everything on an annual basis (the correct way, since the brackets are
progressive and the tax credits are annual) and divides by 12 for the monthly view.

## Tech stack

- **React 18** — one component; `useState` for inputs, a single `useMemo` for the
  whole bruto→netto calculation.
- **Vite 5** — dev server and production bundler.
- **Plain CSS** — all styling lives in a `<style>` block in the component, scoped
  under a `.kg-` prefix and driven by CSS custom properties. No CSS framework, no
  UI library.
- **SVG** — the duck logo and feather motifs are hand-drawn inline SVG.
- **Google Fonts** (Fraunces, Archivo, IBM Plex Mono) loaded via `@import`, with
  system fallbacks offline.

Total runtime dependency footprint: `react` and `react-dom`. Nothing else.

## Getting started

Prerequisites: **Node.js 18+**.

```bash
npm install      # install dependencies
npm run dev      # dev server at http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

## Project structure

```
kaalgeplukt/
├── index.html                  # entry HTML, favicon + meta, mounts #root
├── vite.config.js              # Vite + React config
├── package.json
├── public/
│   └── kaalgeplukt-logo.svg     # duck logo, also the favicon
└── src/
    ├── main.jsx                # React entry point
    ├── App.jsx                 # the calculator: tax logic + UI
    └── index.css              # minimal reset so the background fills the viewport
```

Everything meaningful is in **`src/App.jsx`**. The top holds the calculation — the
bracket table, the two tax-credit functions, and `compute()`. The bottom half is
the UI.

## Where the numbers come from

Official **2026** values for someone **under AOW age**, **no fiscal partner**,
**income from employment only**:

- **Box 1 brackets:** 35.75% up to €38,883 · 37.56% up to €78,426 · 49.50% above
  (bracket 1 includes national-insurance premiums).
- **Algemene heffingskorting:** max €3,115, tapering from €29,736 at 6.398%.
- **Arbeidskorting:** the official four-phase 2026 table, max €5,685, tapering from
  €45,592 at 6.510%.
- **Thuiswerkvergoeding:** €2.45/day tax-free (2026), a *gerichte vrijstelling* —
  added to take-home, never taxed.

To update for a future tax year, edit the `BRACKETS` array and the
`algemeneHeffingskorting` / `arbeidskorting` functions near the top of
`src/App.jsx`. They are the single source of truth.

## Disclaimer

For informational purposes only. This is an estimate to plan with — **not tax,
legal, or financial advice**. Verify against your own payslip and consult the
Belastingdienst or an adviser before making decisions.

## License

MIT — see [LICENSE](./LICENSE).
