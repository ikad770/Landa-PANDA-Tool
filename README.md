# Landa PANDA Tool

Static v0.1 GitHub-only baseline for the Landa PANDA Tool.

PANDA means **Proactive Analyzer Notification DA**. This baseline is a standalone service-tool prototype that opens directly from `index.html` or GitHub Pages without installing anything and without building a bundle.

## How to use

1. Open `index.html` directly in a browser.
2. Or enable GitHub Pages from the repository main branch root.
3. Open the GitHub Pages URL.

## No setup required

- No npm install required.
- No build required.
- No Vite required.
- No local server required.
- No external network dependency.

## What this baseline includes

- Dark enterprise SaaS-style PANDA interface.
- Service Radar, Upload Logs, Rules Catalog, Machines, Alerts, Settings, and BSS Drill-down screens.
- Browser-only upload controls for multiple files or folders.
- Path/name scanning to infer machine IDs such as `S100100025` or `D110100023`.
- Path/name detection for possible OPC archives, possible logs, and system tokens: BSS, IRD, IPS, FEC, ECC, LLCI, DPS, and QCS.
- Initial static rules catalog for PSS, IRD, BSS, IPS, and NPD examples.
- State-aware mock issue explanation for the BSS Blanket System.

## Supported upload shape

```text
Root folder with machine folders:
S100100025/
D110100023/
Each may contain autocollect zip / opc.zip / logs
```

This version does not deeply parse archives. It uses the browser File API to inspect selected file names and relative paths only.

## Future direction

This is intentionally a stable GitHub-first prototype. Later, when the project is ready for local development and deployment automation, it can be migrated back to a framework-based implementation.
