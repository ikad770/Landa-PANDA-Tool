# PANDA Tool — V4 Data Foundation

This repository now contains the clean PANDA V4 backend data foundation alongside the previous static browser prototype. The old browser runtime remains as reference only; V4 ingestion, signal discovery, state timelines, diagnostics, and bounded series querying are implemented in `backend/` and do not depend on Grafana or the old worker pipeline.

## What V4 implements in this milestone

- Ingests BSS, FEC, and MachineStates CSV/text files directly or inside normal/nested ZIP archives.
- Detects exact real source headers before parsing.
- Builds deterministic signal identities from press, source, system, component, device, and signal name; filenames are never used as signal identities.
- Stores numeric time-series points incrementally in the backend store and exports normalized Parquet partitions when DuckDB/Parquet support is available.
- Builds Machine State and System State intervals from sparse MachineStates and source state updates.
- Aligns signal points with relevant state intervals using set-based storage updates.
- Exposes versioned FastAPI endpoints for health, ingestions, systems, components, signals, bounded series, states, and diagnostics.
- Provides pytest coverage for parsers, archives, storage, APIs, and an opt-in one-million-row scale test.

Rules evaluation, alerts, Azure integration, Service Radar UI, and System Drill-Down UI are intentionally not implemented in this PR.

## Repository layout

```text
backend/
  app/
    api/                 Versioned API endpoints
    core/                Settings and structured logging
    ingestion/           Upload and archive traversal
    models/              Canonical domain models
    parsers/             BSS, FEC, and MachineStates parsers
    services/            Ingestion, state, and catalog services
    storage/             DuckDB-facing store and Parquet export helper
  tests/                 pytest suite
  pyproject.toml         Backend dependencies and pytest config
frontend/README.md       Placeholder for future React work
data/
  raw/                   Runtime uploads, ignored by Git
  processed/             Runtime DuckDB/Parquet outputs, ignored by Git
scripts/                 Windows setup/run/test helpers
```

## Local backend setup

### Standard Python venv

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e "backend[test]"
```

### Anaconda Prompt

```bat
conda create -n panda-v4 python=3.11
conda activate panda-v4
python -m pip install --upgrade pip
python -m pip install -e backend[test]
```

If package installation is blocked by a corporate proxy, the parser/storage tests can still run in this repository's dependency-limited fallback mode, but production development should install the declared backend dependencies.

## Run the backend

```bash
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open Swagger/OpenAPI documentation at:

```text
http://127.0.0.1:8000/docs
```

## Run tests

```bash
python -m pytest backend
```

Run the opt-in scale test:

```bash
PANDA_RUN_SCALE_TEST=1 python -m pytest backend/tests/test_scale.py -s
```

Windows helper scripts:

```bat
scripts\setup_windows.bat
scripts\run_backend.bat
scripts\run_tests.bat
```

## Configuration

Copy `.env.example` or set environment variables directly:

- `PANDA_DATA_DIR`
- `PANDA_DUCKDB_PATH`
- `PANDA_MAX_UPLOAD_MB`
- `PANDA_MAX_ARCHIVE_DEPTH`
- `PANDA_MAX_ARCHIVE_FILES`
- `PANDA_MAX_UNCOMPRESSED_MB`
- `PANDA_BATCH_SIZE`
- `PANDA_DEFAULT_MAX_POINTS`

Generated `.duckdb`, `.db`, and `.parquet` files belong under `data/processed/` and are ignored by Git.

## Legacy static prototype

The original static Service Radar prototype files (`index.html`, `app.js`, `worker.js`, `v2-pipeline.js`, rendering modules, and JavaScript tests) are retained unchanged for historical reference. They are not used by the V4 backend foundation.

## PANDA V4 real Autocollect data validation

Use the backend validation CLI to prove the PANDA V4 data foundation can ingest a real Autocollect session with BSS ZIP/CSV parts, FEC ZIP/CSV parts, and MachineStates CSV files.

### Windows / Anaconda quick start

```bat
conda create -n panda-v4 python=3.11 -y
conda activate panda-v4
python -m pip install -e "backend[test]"
```

Run with an Autocollect root:

```bat
python -m backend.app.tools.validate_real_data ^
--autocollect-root "C:\path\to\autocollect-v8-..." ^
--press-id "D14" ^
--json-output "data\validation\D14-report.json"
```

Run with explicit source directories:

```bat
python -m backend.app.tools.validate_real_data ^
--bss-dir "C:\path\OPC\Logs\LLCINotifications\BSS" ^
--fec-dir "C:\path\OPC\Logs\FECNotifications" ^
--machine-states-dir "C:\path\OPC\Logs\MachineStates" ^
--press-id "D14"
```

Add `--reset-runtime-data` to clear only configured PANDA runtime tables and generated processed outputs before a run. The command prints `PASS`, `FAIL`, and non-fatal `WARNING` criteria. Runtime outputs are normally under `data/processed` for the DuckDB-compatible database and Parquet export, `data/validation` for JSON reports, and the console/application logs for diagnostics. GitHub cloud validation cannot read local real logs unless fixtures are explicitly provided, so CI uses generated text fixtures.

See `docs/real-data-validation.md` for the complete workflow and interpretation guide.
