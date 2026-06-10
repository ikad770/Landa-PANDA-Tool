from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Annotated

try:
    from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
except ModuleNotFoundError:  # dependency-limited environments can still import and test services
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            self.status_code = status_code; self.detail = detail; super().__init__(detail)
    class APIRouter:
        def __init__(self, *args, **kwargs): pass
        def get(self, *args, **kwargs): return lambda fn: fn
        def post(self, *args, **kwargs): return lambda fn: fn
    def Depends(value=None): return value
    def File(*args, **kwargs): return None
    def Query(default=None, *args, **kwargs): return default
    class UploadFile: pass

from backend.app.core.config import Settings, get_settings
from backend.app.ingestion.local_upload import save_uploads
from backend.app.models.domain import IngestionRun, SeriesPoint, SeriesResponse, StateInterval
from backend.app.services.ingestion_service import IngestionService
from backend.app.services.state_service import relevant_state_system
from backend.app.storage.duckdb_store import DuckDBStore

router = APIRouter(prefix="/api/v1", tags=["PANDA V4 data foundation"])


def get_store(settings: Settings = Depends(get_settings)) -> DuckDBStore:
    return DuckDBStore(settings.duckdb_path)


@router.get("/health", summary="Backend and database health")
def health(store: DuckDBStore = Depends(get_store)) -> dict[str, object]:
    return {"backend": "ok", **store.health()}


@router.post("/ingestions", response_model=IngestionRun, summary="Synchronously ingest BSS/FEC/MachineStates files")
async def create_ingestion(
    files: Annotated[list[UploadFile], File(description="BSS ZIP/CSV, FEC ZIP/CSV, and MachineStates CSV inputs")],
    press_id: str = Query("default", description="Stable press identifier used in signal identity"),
    settings: Settings = Depends(get_settings),
    store: DuckDBStore = Depends(get_store),
) -> IngestionRun:
    paths = await save_uploads(files, settings.raw_dir, settings.max_upload_mb * 1024 * 1024)
    return IngestionService(store, settings).ingest_paths(paths, press_id=press_id)


@router.get("/ingestions/{ingestion_id}", summary="Return ingestion counters")
def get_ingestion(ingestion_id: str, store: DuckDBStore = Depends(get_store)) -> dict[str, object]:
    run = store.get_run(ingestion_id)
    if not run:
        raise HTTPException(status_code=404, detail="ingestion not found")
    return run


@router.get("/systems", summary="List discovered systems and signal counts")
def systems(store: DuckDBStore = Depends(get_store)) -> list[dict[str, object]]:
    return store.list_systems()


@router.get("/systems/{system_id}/components", summary="List components for a system")
def components(system_id: str, store: DuckDBStore = Depends(get_store)) -> list[dict[str, object]]:
    return store.list_components(system_id)


@router.get("/signals", summary="List signals with filters")
def signals(
    system: str | None = None,
    component: str | None = None,
    source_type: str | None = None,
    search: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    store: DuckDBStore = Depends(get_store),
) -> list[dict[str, object]]:
    return store.list_signals(system, component, source_type, search, start, end)


@router.get("/signals/{signal_id}", summary="Return one signal definition")
def signal(signal_id: str, store: DuckDBStore = Depends(get_store)) -> dict[str, object]:
    found = store.get_signal(signal_id)
    if not found:
        raise HTTPException(status_code=404, detail="signal not found")
    return found


@router.get("/signals/{signal_id}/series", response_model=SeriesResponse, summary="Return bounded display series and full-resolution aggregates")
def signal_series(
    signal_id: str,
    start: datetime | None = None,
    end: datetime | None = None,
    max_points: int = Query(2000, ge=2, le=10000),
    include_states: bool = True,
    store: DuckDBStore = Depends(get_store),
) -> SeriesResponse:
    meta = store.get_signal(signal_id)
    if not meta:
        raise HTTPException(status_code=404, detail="signal not found")
    agg, rows = store.series(signal_id, max_points, start, end)
    machine: list[StateInterval] = []
    system: list[StateInterval] = []
    if include_states:
        machine = store.intervals("Machine", start or agg.get("first"), end or agg.get("last"))
        system_name = relevant_state_system(str(meta["system"]))
        system = store.intervals(system_name, start or agg.get("first"), end or agg.get("last"))
    return SeriesResponse(
        total_point_count=int(agg["total"]),
        returned_point_count=len(rows),
        downsampled=int(agg["total"]) > len(rows),
        latest=agg["latest"],
        minimum=agg["minimum"],
        maximum=agg["maximum"],
        average=agg["average"],
        first_timestamp=agg["first"],
        last_timestamp=agg["last"],
        points=[SeriesPoint(**row) for row in rows],
        machine_state_intervals=machine,
        system_state_intervals=system,
    )


@router.get("/states", response_model=list[StateInterval], summary="Return Machine or System State intervals")
def states(system: str | None = None, start: datetime | None = None, end: datetime | None = None, store: DuckDBStore = Depends(get_store)) -> list[StateInterval]:
    return store.intervals(system, start, end)


@router.get("/diagnostics", summary="Return ingestion diagnostics")
def diagnostics(ingestion_id: str | None = None, level: str | None = None, source_file: str | None = None, code: str | None = None, store: DuckDBStore = Depends(get_store)) -> list[dict[str, object]]:
    return store.diagnostics(ingestion_id, level, source_file, code)
