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
