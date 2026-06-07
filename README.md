# PANDA Tool — Local Service Radar

PANDA Tool is a browser-only analysis workspace and Service Radar for Landa autocollect ZIP packages. The application remains runnable from static files and does not require a backend.

## How to run

Because the worker and application scripts use ES modules, serve the directory with a lightweight local HTTP server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

## Project structure

```text
index.html       Static application shell
styles.css       Workspace, Service Radar, hotspot, drill-down, and diagnostics styling
app.js           Main-thread state, worker lifecycle, progress, and view switching
worker.js        Rule-first ZIP indexing, source parsing, runtime aggregation, compact result finalization
adapters.js      Formal source adapter implementations and source-specific timestamp parsing
evaluation.js    Rule normalization, tolerance parsing, state selection, and value evaluation
render.js        Service Radar, drill-down, timeline, evidence, and diagnostics rendering
config.js        Stage weights, limits, statuses, and SYSTEM_HOTSPOTS configuration
assets/          Drop machine image assets here
```

## Expected ZIP structure

The uploaded autocollect ZIP must contain a nested `opc.zip`. Inside `opc.zip`, the worker selectively inspects only folders required by the Rules Excel.

Common source locations:

```text
logs/MachineStates/
logs/LLCINotifications/BSS/
logs/LLCINotifications/IPS/
logs/FECNotifications/
logs/AlertsMonitoring/
```

Example: if the rules only reference `BSSNotifications`, the worker opens `logs/MachineStates/` and `logs/LLCINotifications/BSS/` source files and skips unrelated FEC, IPS, and AlertsMonitoring locations.

## Supported log sources

The built-in adapters are:

- `BSSNotifications`
- `IPSNotifications`
- `FECNotifications`
- `MachineStates`
- `AlertsMonitoring`

`AlertsMonitoring` remains contextual unless a rule explicitly references it as a log source.

## Rules Excel requirements

The workbook must contain a sheet named:

```text
PANDA Rules Template
```

The parser detects the actual header row by requiring these columns anywhere on the header row:

- `System`
- `Subsystem`
- `Component`
- `Log Signal Name`
- `Log Source`

Supported expected-value state columns:

- `Expected ON`
- `Expected Standby`
- `Expected Ready`
- `Expected Prepare2Print`
- `Expected Printing`
- `Expected PrintEnd`
- `Expected Recovery`
- `Expected Error`

Supported check types:

- `Range`
- `Above Threshold`
- `Below Threshold`
- `Exact`

Recognized but intentionally pending evaluators:

- `Delta`
- `Trend`
- `Flatline`
- `StateDependent`

Supported tolerance/limit formats include `±2`, `+/-2`, `2`, `±10%`, `+/-10%`, `10%`, `60 Max`, and `10 Min`.

Invalid or incomplete rules are retained in diagnostics and are not counted as successfully evaluated.

## Machine image asset

The Service Radar references:

```text
assets/landa-machine.png
```

If the file is absent, the UI falls back to a neutral dark machine silhouette. Drop the real Landa machine reference at that path without changing code.

The image is styled with:

```css
.machine-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
}
```

## How to configure hotspot positions

Edit `SYSTEM_HOTSPOTS` in `config.js`. Each entry uses percentages in the machine canvas:

```js
DPS: { x: 22, y: 51, labelX: 8, labelY: 35 }
```

- `x`, `y`: circular status node position
- `labelX`, `labelY`: label card position

Rendering reads this configuration; hotspot coordinates are not hard-coded in render logic.

## How to add a new source adapter

1. Add a new adapter object in `adapters.js` with the required interface:

```js
{
  sourceType,
  pathPatterns,
  requiredFields,
  canHandlePath(path),
  cleanText(text),
  normalizeHeader(header),
  normalizeRow(row),
  getTimestampMs(row),
  getPreferredSignal(row),
  getCompositeSignal(row),
  getNumericValue(row),
  getComponent(row),
  getSystem(row, rule),
  getSubsystem(row, rule)
}
```

2. Make sure `canHandlePath()` matches only the source folder needed for that adapter.
3. Implement explicit timestamp parsing. Do not use `Date.parse()` for ambiguous slash dates.
4. Use the new adapter's `sourceType` in the Rules Excel `Log Source` column.

## Known limitations

- Browser JSZip still has to materialize a decompressed CSV string for each selected file. The refactor limits this by opening only required files, processing one file at a time, releasing text references after parsing, and retaining only compact aggregates.
- Delta, Trend, Flatline, and StateDependent evaluators are recognized but reported as `evaluator_pending` until dedicated algorithms are implemented.
- Source-specific timestamp formats for FEC and IPS use ISO-like parsing with an MDY fallback; update the corresponding adapter if a stricter known format is supplied.
- The repository does not include the final Landa machine PNG. Place it at `assets/landa-machine.png`.
