from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from backend.app.core.config import Settings
from backend.app.services.ingestion_service import IngestionService
from backend.app.storage.duckdb_store import DuckDBStore
from backend.tests.conftest import BSS_HEADER


@pytest.mark.skipif(os.getenv("PANDA_RUN_SCALE_TEST") != "1", reason="Set PANDA_RUN_SCALE_TEST=1 to run the 1,000,000-row scale test")
def test_one_million_scale_ingestion(tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "data", duckdb_path=tmp_path / "data" / "processed" / "scale.duckdb", batch_size=50000, default_max_points=100)
    store = DuckDBStore(settings.duckdb_path)
    path = tmp_path / "million_bss.csv"
    rows = 1_000_000
    signals = ["TubActualLevelMM", "FillActualTemperatureC", "DrainPressure", "PumpSpeed"]
    systems = {"BSS"}
    with path.open("w", encoding="utf-8") as handle:
        handle.write(BSS_HEADER)
        for i in range(rows):
            handle.write(f"05/07/2026 10:{(i // 60) % 60:02d}:{i % 60:02d},,Parameter,k{i%4},S10,BCUMonitor,{signals[i%4]},Double,{i % 1000},False\n")
    t0 = time.perf_counter()
    run = IngestionService(store, settings).ingest_paths([path], press_id="scale")
    runtime = time.perf_counter() - t0
    assert run.numeric_points_written == rows
    assert store.count_points() == rows
    assert len(store.list_signals()) == 4
    assert {s["system"] for s in store.list_systems()} == systems
    signal_id = store.list_signals()[0]["signal_id"]
    agg, points = store.series(signal_id, max_points=100)
    assert agg["total"] == rows // 4
    assert len(points) <= 100
    print({"rows": rows, "signals": 4, "systems": sorted(systems), "runtime_seconds": round(runtime, 3), "stored_point_count": rows, "maximum_api_response_points": 100})
    store.close()
