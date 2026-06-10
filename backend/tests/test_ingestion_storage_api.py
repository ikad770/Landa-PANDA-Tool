from __future__ import annotations

import io
import time
from pathlib import Path

from backend.tests.conftest import BSS_HEADER, FEC_HEADER, MACHINE_HEADER, make_zip, write_text


def sample_bss() -> str:
    return BSS_HEADER + "\n".join([
        "05/07/2026 10:00:00,,Parameter,k1,S10,BCUMonitor,TubActualLevelMM,Double,1,False",
        "05/07/2026 10:01:00,,Parameter,k1,S10,BCUMonitor,TubActualLevelMM,Double,2,False",
        "05/07/2026 10:02:00,,Parameter,k2,S10,BCUMonitor,FillActualTemperatureC,Double,0,False",
        "05/07/2026 10:03:00,,Parameter,k2,S10,BCUMonitor,FillActualTemperatureC,Double,bad,False",
    ]) + "\n"


def sample_fec() -> str:
    return FEC_HEADER + "\n".join([
        "05/07/2026 10:00:00,ControlStatus,CableA,IPU1 Pressure(12345),10,True,False,False,On,0,",
        "05/07/2026 10:01:00,DeviceStatus,CableB,WaterInTemp(88),20,True,False,False,On,0,",
        "05/07/2026 10:02:00,StateMachine,,IPU,,,False,False,,0,Running",
    ]) + "\n"


def sample_machine() -> str:
    blanks = ["---"] * 16
    row1 = ["05/07/2026 09:59:00", "Idle", "Ready", *blanks[2:]]
    row2 = ["05/07/2026 10:01:30", "Printing", "---", "---", "---", "---", "Running", *blanks[6:]]
    row3 = ["05/07/2026 10:02:30", "---", "Processing", *blanks[2:]]
    return MACHINE_HEADER + ",".join(row1) + "\n" + ",".join(row2) + "\n" + ",".join(row3) + "\n"


def test_archive_root_nested_depth_path_traversal_and_unsupported(tmp_path, service, store):
    nested = tmp_path / "nested.zip"
    make_zip(nested, {"fec.csv": sample_fec()})
    root = make_zip(tmp_path / "root.zip", {"bss.csv": sample_bss(), "nested.zip": nested.read_bytes(), "../evil.csv": sample_bss(), "notes.md": "skip"})
    run = service.ingest_paths([root], press_id="press-a")
    assert run.status == "completed"
    assert run.files_parsed == 2
    assert run.numeric_points_written == 5
    assert any(d["code"] == "path_traversal" for d in store.diagnostics())
    assert any(d["code"] == "unsupported_file" for d in store.diagnostics())


def test_archive_max_depth_handling(tmp_path, settings, store):
    from backend.app.services.ingestion_service import IngestionService
    settings = settings.__class__(data_dir=settings.data_dir, duckdb_path=settings.duckdb_path, max_archive_depth=1, batch_size=10)
    inner = make_zip(tmp_path / "inner.zip", {"bss.csv": sample_bss()})
    outer = make_zip(tmp_path / "outer.zip", {"inner.zip": inner.read_bytes()})
    run = IngestionService(store, settings).ingest_paths([outer])
    assert run.status == "completed"
    assert any(d["code"] == "archive_depth_limit" for d in store.diagnostics(run.ingestion_id))


def test_storage_catalog_intervals_counters_and_series(tmp_path, service, store):
    bss = write_text(tmp_path / "bss.csv", sample_bss())
    fec = write_text(tmp_path / "fec.csv", sample_fec())
    machine = write_text(tmp_path / "MachineStates.csv", sample_machine())
    run = service.ingest_paths([bss, fec, machine], press_id="press-a")
    assert run.status == "completed"
    assert run.numeric_points_written == 5
    assert run.invalid_rows == 1
    systems = store.list_systems()
    assert {s["system"] for s in systems} >= {"BSS", "IPU", "CWS"}
    signals = store.list_signals(system="BSS")
    assert len(signals) == 2
    assert len({s["signal_id"] for s in signals}) == 2
    intervals = store.intervals("Machine")
    assert [(i.state, i.duration_ms) for i in intervals if i.duration_ms is not None] == [("Idle", 150000)]
    signal_id = signals[0]["signal_id"]
    agg, points = store.series(signal_id, max_points=1)
    assert agg["total"] >= 1
    assert len(points) <= 1
    assert store.get_run(run.ingestion_id)["numeric_points_written"] == 5


def test_api_endpoint_functions(tmp_path, service, store):
    from backend.app.api import v1
    bss = write_text(tmp_path / "bss.csv", sample_bss())
    run = service.ingest_paths([bss], press_id="press-api")
    assert v1.health(store)["backend"] == "ok"
    assert v1.get_ingestion(run.ingestion_id, store)["status"] == "completed"
    assert v1.systems(store)[0]["system"] == "BSS"
    assert v1.components("BSS", store)[0]["component"] == "BCUMonitor"
    found = v1.signals(system="BSS", store=store)
    signal_id = found[0]["signal_id"]
    assert v1.signal(signal_id, store)["signal_id"] == signal_id
    series = v1.signal_series(signal_id, max_points=2, include_states=True, store=store)
    assert series.returned_point_count <= 2
    assert isinstance(v1.states(store=store), list)
    assert isinstance(v1.diagnostics(ingestion_id=run.ingestion_id, store=store), list)
    try:
        v1.signal("not-real", store)
    except Exception as exc:
        assert getattr(exc, "status_code") == 404
    else:
        raise AssertionError("invalid signal id should raise 404")


def test_large_synthetic_rows_processed_in_batches(tmp_path, settings, store):
    from backend.app.services.ingestion_service import IngestionService
    settings = settings.__class__(data_dir=settings.data_dir, duckdb_path=settings.duckdb_path, batch_size=7777, default_max_points=100)
    path = tmp_path / "large_bss.csv"
    rows = 100_000
    with path.open("w", encoding="utf-8") as handle:
        handle.write(BSS_HEADER)
        for i in range(rows):
            signal = "TubActualLevelMM" if i % 2 == 0 else "FillActualTemperatureC"
            handle.write(f"05/07/2026 10:{(i // 60) % 60:02d}:{i % 60:02d},,Parameter,k{i%2},S10,BCUMonitor,{signal},Double,{i % 100},False\n")
    run = IngestionService(store, settings).ingest_paths([path])
    assert run.numeric_points_written == rows
    assert store.count_points() == rows
    signal_id = store.list_signals(search="TubActual")[0]["signal_id"]
    agg, points = store.series(signal_id, max_points=25)
    assert agg["maximum"] == 98
    assert len(points) <= 25
