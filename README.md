# Landa PANDA Tool

Static premium prototype for **Landa PANDA Tool — Proactive Analyzer Notification DA**.

This version is intentionally built as a **single self-contained `index.html`** so it works immediately when opened locally, uploaded to GitHub Pages, or served by any static server. No Vite build and no `/src/main.jsx` are required, so it avoids the 404 issue from the first package.

## How to run

Just open:

```text
index.html
```

Or serve the folder with any static server.

## Screens included

- Service Radar overview
- Full Landa-style press digital twin
- Clickable system hotspots
- Active BSS issue panel
- StateMachine timeline
- Evidence log
- Recommended service actions
- BSS Blanket System drill-down
- Component-level cutaway view
- Root-cause / health / rules panels

## Current scope

This is a front-end UI prototype with mock data. Next step: connect real parser for `autocollect.zip / opc.zip / logs`.
