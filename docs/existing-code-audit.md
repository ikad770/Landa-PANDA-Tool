# Existing code audit for PANDA V4 foundation

The repository was inspected before implementation. It currently contains a static browser-only Service Radar prototype with JavaScript modules, a module worker, client-side archive/rules parsing, and Node module tests.

## Reusable without changes

- `assets/README.md` and `assets/.gitkeep`: text-only local asset guidance.
- Existing static prototype files are left untouched as historical reference so this PR does not break the old demo path.

## Reusable after modification

- Header names and source-schema knowledge in `adapters.js` informed the Python parser test fixtures, but the runtime code was not reused.
- Sparse MachineStates carry-forward behavior in `machine-states.js` informed the backend implementation, but the browser implementation was not copied.

## Reference only

- `rules.js`, `evaluation.js`, and rendering modules are reference for future rules and UI work only. Rules evaluation is intentionally excluded from V4 milestone 1.
- `tests/module-tests.mjs` documents prior prototype expectations but does not validate the backend architecture.

## Obsolete or unsafe for the new foundation

- `worker.js`, `v2-pipeline.js`, and browser upload orchestration in `app.js` perform front-end ZIP analysis and pass large analysis payloads through browser memory. The V4 backend does not call these modules.
- Existing chart/result assembly patterns are not used because the new API returns bounded series and stores full-resolution points in DuckDB/Parquet under `data/processed/`.
- Filename-based display fallbacks are not used for signal identity; V4 signal IDs are deterministic hashes over press, source, system, component, device, and normalized signal name.
