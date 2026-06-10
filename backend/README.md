# PANDA V4 backend

The backend is the stable data foundation for PANDA V4. It ingests real BSS, FEC, and MachineStates log structures, stores normalized numeric time-series data, builds state intervals, and exposes bounded APIs for exploratory and future UI work.

## Install

```bash
python -m pip install -e "backend[test]"
```

## Run

```bash
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger/OpenAPI is available at `/docs` when FastAPI is installed.

## Test

```bash
python -m pytest backend
```

Run the explicit one-million-row scale test when needed:

```bash
PANDA_RUN_SCALE_TEST=1 python -m pytest backend/tests/test_scale.py -s
```

## API scope

- `GET /api/v1/health`
- `POST /api/v1/ingestions`
- `GET /api/v1/ingestions/{ingestion_id}`
- `GET /api/v1/systems`
- `GET /api/v1/systems/{system_id}/components`
- `GET /api/v1/signals`
- `GET /api/v1/signals/{signal_id}`
- `GET /api/v1/signals/{signal_id}/series`
- `GET /api/v1/states`
- `GET /api/v1/diagnostics`

## Real Autocollect validation CLI

The backend includes a production-path validation command for real PANDA V4 Autocollect data. It discovers BSS, FEC, and MachineStates folders, ingests all supported files in each source as one logical history, deduplicates exact split-file overlaps, rebuilds the catalog and state intervals, and validates queryable systems/signals/series/states.

Windows Anaconda setup:

```bat
conda create -n panda-v4 python=3.11 -y
conda activate panda-v4
python -m pip install -e "backend[test]"
```

Autocollect-root mode:

```bat
python -m backend.app.tools.validate_real_data ^
--autocollect-root "C:\path\to\autocollect-v8-..." ^
--press-id "D14" ^
--json-output "data\validation\D14-report.json"
```

Explicit-directory mode:

```bat
python -m backend.app.tools.validate_real_data ^
--bss-dir "C:\path\OPC\Logs\LLCINotifications\BSS" ^
--fec-dir "C:\path\OPC\Logs\FECNotifications" ^
--machine-states-dir "C:\path\OPC\Logs\MachineStates" ^
--press-id "D14"
```

Use `--reset-runtime-data` only when you want to clear configured PANDA runtime tables and generated processed outputs. The reset refuses unsafe paths and never deletes source logs. The final line is exactly `PANDA REAL-DATA VALIDATION: PASS` or `PANDA REAL-DATA VALIDATION: FAIL`; warnings are non-fatal unless a fail criterion is also present. See `../docs/real-data-validation.md` for details, runtime output locations, and GitHub fixture limitations.
