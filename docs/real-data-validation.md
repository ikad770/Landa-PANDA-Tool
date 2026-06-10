# PANDA V4 real-data validation

This workflow validates the PANDA V4 data foundation against the real extracted Autocollect folder layout. It uses the production archive reader, BSS parser, FEC parser, MachineStates parser, ingestion service, DuckDB-compatible storage layer, signal catalog, state interval builder, and FastAPI query storage APIs. It does not implement Service Radar UI, Rules, Alerts, or Azure integration.

## Windows / Anaconda workflow

1. Open **Anaconda Prompt**.

2. Create the environment:

   ```bat
   conda create -n panda-v4 python=3.11 -y
   ```

3. Activate it:

   ```bat
   conda activate panda-v4
   ```

4. Install the backend and test extras from the repository root:

   ```bat
   python -m pip install -e "backend[test]"
   ```

5. Validate by Autocollect root:

   ```bat
   python -m backend.app.tools.validate_real_data ^
   --autocollect-root "C:\path\to\autocollect-v8-..." ^
   --press-id "D14" ^
   --json-output "data\validation\D14-report.json"
   ```

6. Validate by explicit directories:

   ```bat
   python -m backend.app.tools.validate_real_data ^
   --bss-dir "C:\path\OPC\Logs\LLCINotifications\BSS" ^
   --fec-dir "C:\path\OPC\Logs\FECNotifications" ^
   --machine-states-dir "C:\path\OPC\Logs\MachineStates" ^
   --press-id "D14" ^
   --json-output "data\validation\D14-report.json"
   ```

7. Reset only configured PANDA runtime data before validation when needed:

   ```bat
   python -m backend.app.tools.validate_real_data ^
   --autocollect-root "C:\path\to\autocollect-v8-..." ^
   --press-id "D14" ^
   --reset-runtime-data
   ```

## Input discovery

`--autocollect-root` may point to either the extracted Autocollect directory or the nested `OPC` directory. Discovery is case-insensitive, separator-safe, deterministic, and resolves:

- `OPC/Logs/LLCINotifications/BSS`
- `OPC/Logs/FECNotifications`
- `OPC/Logs/MachineStates`

Explicit directory mode accepts any subset of `--bss-dir`, `--fec-dir`, and `--machine-states-dir`, but at least one source must be supplied. Source directories are scanned in stable filename order. BSS and FEC accept `.zip`, `.csv`, `.txt`, and `.log`; MachineStates accepts `.csv`, `.txt`, and `.log`. Temporary Office files such as `~$...`, hidden OS files, nested folders, and unsupported extensions are ignored with diagnostics.

## Multi-file ingestion and deduplication

All files for a source are one logical history. BSS ZIP parts and current CSV files are ingested together. FEC ZIP parts and current CSV files are ingested together. MachineStates CSV/text parts are ingested together. The storage layer rebuilds the signal catalog and state intervals from parsed timestamps, not archive order.

Exact duplicate numeric points are removed using the normalized identity: press, source type, system, component, device, signal ID/name, timestamp, numeric value, and unit. Rows with the same timestamp but different signal, device, or value are preserved. Exact duplicate state updates are removed by press, scope, system, timestamp, and state before adjacent identical state intervals are merged.

## Report interpretation

The CLI prints eight sections:

1. Input discovery
2. Ingestion counters
3. Time coverage
4. System catalog
5. Example hierarchy
6. Series validation
7. Diagnostics
8. Final result

`PANDA REAL-DATA VALIDATION: PASS` means the selected real/generated inputs produced consistent systems, signals, time series, state intervals, and bounded query responses. `FAIL` includes failed criteria and exits non-zero. `WARNING` indicates non-fatal issues such as unsupported files, invalid timestamps, or some unclassified FEC signals.

## Runtime outputs

By default, the backend uses the same settings as the application:

- DuckDB-compatible runtime file: `data/processed/panda.duckdb` unless `PANDA_DUCKDB_PATH` is set.
- Parquet export: `data/processed/signal_points.parquet` when optional export succeeds.
- JSON report: the path passed to `--json-output`, commonly `data/validation/D14-report.json`.
- Application logs: console output from the command or FastAPI process.

JSON reports are bounded summaries. They include metadata, source discovery, ingestion and deduplication summaries, system summaries, example hierarchy, series validation summaries, diagnostic counts, warnings, and pass/fail criteria. They do not include raw rows, full time series, archive bytes, uploads, or database contents.

GitHub cloud validation cannot access local real log files unless explicit generated fixtures or sanitized fixtures are provided. CI therefore uses generated text fixtures and ZIPs only.
