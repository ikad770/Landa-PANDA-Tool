# Landa PANDA Tool

Landa PANDA Tool is a GitHub-only static browser app for early PANDA log discovery and preliminary machine analysis.

The app is intentionally simple to deploy:

- Open `index.html` directly in a browser, or serve it with GitHub Pages.
- No npm is required.
- No build step is required.
- No Vite, React, backend service, Vercel deployment, CDN script, external stylesheet, or external asset is used.
- ZIP archive inspection is performed in the browser through the committed local text JavaScript file `vendor/jszip.min.js`.

## Current focus

The current version reads uploaded machine logs and generates useful preliminary analysis from the actual log data it can parse. It does **not** validate against configured parameter thresholds yet.

Current analysis is based on:

- uploaded file and folder discovery;
- root and nested ZIP inspection, limited to a safe browser depth;
- OPC/archive candidate discovery;
- log candidate detection;
- StateMachine timeline extraction;
- numeric signal discovery and signal profiling;
- preliminary anomaly heuristics such as spike candidates, flatline candidates, missing state context, and repeated warning/error text.

## Rules and parameter limits

Rules file pending.

No rules file is loaded yet. Upload the approved PANDA parameter template when ready. Parameter limits are not loaded yet, so the app does not claim rules-based threshold validation, configured severity, or production alert certainty.

## How to use

1. Open `index.html` directly, or publish the repository with GitHub Pages.
2. Go to **Upload Logs**.
3. Use **Upload ZIP / files** for individual logs and archive files.
4. Use **Upload folder** for a machine root folder or a folder containing multiple machines.
5. Review scan progress, machine inventory, warnings, parsed log samples, and preliminary findings.
6. Select a machine row to update the Service Radar, Analysis screen, evidence panels, signal discovery, and BSS placeholder panel.

Supported folder patterns include machine folders such as:

```text
S100100025/
D110100023/
S100100026/
```

Each machine folder may include autocollect ZIPs, nested ZIPs, `opc.zip`, `opc/`, `logs/`, `dpc2`, `dpc4`, `dpc6`, `dpc8`, `pcc1`, `pcc2`, and similar log-bearing structures.

Machine IDs are detected with this pattern:

```text
/[SD]\d{8,}/
```

If no machine ID is found, data is grouped under **Unknown machine** and still processed.

## What the UI includes

- **Service Radar** with dark industrial SaaS styling, KPI cards, a CSS-only machine service topology, analysis status, timeline, evidence, signal discovery, and next-step guidance.
- **Upload Logs** with file/folder inputs, visible progress, scan summary cards, machine inventory, warnings/errors, and parsed samples.
- **Machines** inventory with source, archive, OPC, log, parsed-log, system, and signal profile counts.
- **Analysis** with selected machine summary, StateMachine timeline, signal discovery table, preliminary findings, evidence log, and raw log samples.
- **Alerts** placeholder that clearly states there is no rules-based alert yet.
- **Rules Catalog** placeholder that states no rules file is loaded yet.
- **Settings / BSS Drilldown** placeholder with the message “Subsystem visual map pending reference image” plus real detected BSS logs/signals when uploaded.

## Limitations

- Very large ZIP files may be slow because inspection happens in browser memory.
- Deep nested archives are limited to a safe depth to protect the browser.
- Some binary or proprietary logs cannot be parsed as text.
- Very large text logs are sampled from the beginning of the file.
- Threshold validation is pending the approved rules/parameters file.
- Preliminary anomalies are heuristics only and should not be treated as configured P1/P2 rules-based alerts.
