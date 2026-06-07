# PANDA Tool — Service Radar

This repository contains a static, no-build PANDA Tool web application for rule-driven analysis of Landa autocollect archives.

## What the application does

The tool runs the full analysis path in a module worker:

1. Parses the uploaded Rules Excel workbook from the real detected header row.
2. Derives required log sources from valid rules.
3. Opens the root autocollect ZIP, finds `opc.zip`, and indexes only required paths.
4. Parses sparse MachineStates files with forward-filled state transitions.
5. Parses required notification logs, including BSS CSV files inside nested ZIPs.
6. Matches source values to rule signals, including configured aliases.
7. Evaluates actual values against state-specific expected values and tolerances.
8. Consolidates deviation events and returns a compact `AnalysisResult`.
9. Renders Service Radar and Drill-Down views from that same result.

Diagnostics are intentionally isolated from the Service Radar. The internal `analysisAudit` object is available only from Diagnostics.

## Local run instructions

Because the app uses ES modules and a module worker, run it from a local HTTP server instead of opening `index.html` directly.

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## Prototype authentication note

The local Login screen uses a client-side prototype credential only so the static application can demonstrate session flow without a backend. Production authentication must use a secure backend identity service, and credentials must never be exposed in client-side JavaScript.

## Required inputs

- **Autocollect ZIP**: root archive containing a nested `opc.zip`.
- **Rules Excel**: workbook containing a PANDA rules sheet. The Rules header row can appear below row 1 as long as it contains:
  - `System`
  - `Subsystem`
  - `Component`
  - `Log Signal Name`
  - `Log Source`

## Source path mapping

The analyzer opens only paths required by the Rules Excel:

| Log source | Required path |
| --- | --- |
| `BSSNotifications` | `logs/LLCINotifications/BSS/` |
| `IPSNotifications` | `logs/LLCINotifications/IPS/` |
| `FECNotifications` | `logs/FECNotifications/` |
| `MachineStates` | `logs/MachineStates/` |
| `AlertsMonitoring` | `logs/AlertsMonitoring.txt` or `logs/AletrsMonitoring.txt` |

MachineStates are always included when state-dependent rules exist.

## Local machine image fallback

To use the real machine image locally, place the image at:

```text
assets/landa-machine.png
```

The application will automatically use it. If the image is missing, the built-in CSS/SVG fallback is displayed. This fallback is expected until the binary asset is added manually and must not be treated as a data or code failure.


## Files

- `index.html` — static HTML shell.
- `styles.css` — app, Service Radar, hotspot, and Drill-Down styles.
- `app.js` — main-thread state, worker orchestration, progress, and navigation.
- `worker.js` — archive indexing, source parsing, runtime evaluation, compact result assembly.
- `adapters.js` — CSV cleanup, header normalization, timestamp parsing, source adapters, signal matching.
- `rules.js` — Rules Excel parsing and analysis plan construction.
- `machine-states.js` — sparse MachineStates forward-fill and binary-search state lookup.
- `evaluation.js` — expected value selection, tolerance parsing, and status evaluation.
- `render-radar.js` — Service Radar exports.
- `render-drilldown.js` — Drill-Down exports.
- `config.js` — hotspots, stage weights, statuses, source paths, aliases, and limits.
