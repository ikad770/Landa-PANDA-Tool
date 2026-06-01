# Landa PANDA Tool

Static GitHub-only PANDA baseline for the Landa service-tool prototype.

PANDA means **Proactive Analyzer Notification DA**. This repository is intentionally reduced to a self-contained static application that can run from the repository root on GitHub Pages or directly from `index.html`.

## How to open

- Open `index.html` directly in a browser.
- Or enable GitHub Pages from the `main` branch root and browse to the generated Pages URL.

No server is required for the current baseline.

## Static-only constraints

This version does **not** use:

- npm
- Vite
- React
- a build step
- external scripts
- external CSS
- external assets or images

The application logic, styling, and markup are contained in `index.html` with inline `<style>` and inline `<script>` blocks.

## What is included

- Dark industrial enterprise SaaS-style Service Radar screen.
- Header for **Landa PANDA Tool** with the subtitle **Proactive Analyzer Notification DA**.
- KPI cards for machines, OPC archives, log candidates, detected systems, and loaded rules.
- Professional service topology map using CSS-only press silhouettes, system cards, and connector lines.
- Active Issue panel for BSS Blanket System pressure deviation.
- Upload Logs screen with two browser File API upload controls:
  - Upload ZIP / files (`<input type="file" multiple>`)
  - Upload folder (`<input type="file" webkitdirectory multiple>`)
- Rules Catalog screen with initial sample rules from the converted parameter document.
- BSS Drill-down screen with machine context, component navigation, evidence, key signal chart, recommended actions, and related rules.

## Supported upload structure

```text
Root folder:
  S100100025/
    autocollect.zip
    opc.zip
    logs/
  D110100023/
    autocollect.zip
    opc.zip
    logs/
```

## Current scanner behavior

The upload scanner is static and browser-only. It uses the File API and inspects file metadata only:

- `file.name`
- `file.webkitRelativePath`
- `file.size`
- `file.type`

The scanner detects:

- Machine IDs matching `\b[SD]\d{8,}\b`, such as `S100100025`, `S100100026`, `D100100004`, and `D110100023`.
- ZIP archive candidates when a path ends with `.zip`.
- Possible OPC archives when a path includes `opc`.
- Possible logs when a path includes `logs`.
- Autocollect sources when a path includes `autocollect`.
- System tokens in paths or names: BSS, IRD, IPS, FEC, ECC, LLCI, DPS, QCS, PSS, BCU, and NPD.

After selecting files or a folder, the app immediately updates scan KPIs, machine inventory tables, warnings, detected system badges, and the service topology highlights.

## Current limitations

- ZIP files are **not** deeply inspected yet.
- The scanner does not parse real OPC payloads yet.
- StateMachine and signal mapping are represented as UI-ready placeholders.
- Rule evaluation is not connected to real signals yet.
- The BSS subsystem visual intentionally shows a professional placeholder until an approved reference image is supplied.

Deep ZIP inspection will require a future parser or a static JSZip integration. The next phase will connect Excel-derived rules, real OPC logs, StateMachine data, and signal mapping.
