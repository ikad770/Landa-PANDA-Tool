from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient

from backend.app.api.v1 import get_settings, get_store
from backend.app.core.config import Settings
from backend.app.main import app
from backend.app.storage.duckdb_store import DuckDBStore
from backend.tests.conftest import BSS_HEADER, FEC_HEADER, MACHINE_HEADER


def _zip_bytes(name: str, content: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, content)
    return buffer.getvalue()


def _bss_fixture() -> bytes:
    return (
        BSS_HEADER
        + "\n".join(
            [
                "05/07/2026 10:00:00,,Parameter,k-bss-1,S10,BCUMonitor,TubActualLevelMM,Double,1,False",
                "05/07/2026 10:01:00,,Parameter,k-bss-1,S10,BCUMonitor,TubActualLevelMM,Double,2,False",
                "05/07/2026 10:02:00,,Parameter,k-bss-2,S10,BCUMonitor,FillActualTemperatureC,Double,21.5,False",
            ]
        )
        + "\n"
    ).encode("utf-8")


def _bss_overlap_fixture() -> bytes:
    return (
        BSS_HEADER
        + "05/07/2026 10:01:00,,Parameter,k-bss-1,S10,BCUMonitor,TubActualLevelMM,Double,2,False\n"
    ).encode("utf-8")


def _fec_fixture() -> bytes:
    return (
        FEC_HEADER
        + "\n".join(
            [
                "05/07/2026 10:00:00,ControlStatus,CableA,IPU1 Pressure(12345),10,True,False,False,On,0,",
                "05/07/2026 10:01:00,DeviceStatus,CableB,DRY1 PWM(222),30,True,False,False,On,0,",
                "05/07/2026 10:02:00,DeviceStatus,CableC,WaterInTemp(88),20,True,False,False,On,0,",
                "05/07/2026 10:03:00,StateMachine,,IPU,,,False,False,,0,Running",
            ]
        )
        + "\n"
    ).encode("utf-8")


def _machine_states_fixture() -> bytes:
    row1 = ["05/07/2026 09:59:00", "Idle", "Ready", "---", "---", "---", "Ready", "Ready", "Ready", "Ready", "---", "---", "---", "---", "---", "---", "---"]
    row2 = ["05/07/2026 10:01:30", "Printing", "---", "---", "---", "---", "Running", "---", "Running", "Running", "---", "---", "---", "---", "---", "---", "---"]
    row3 = ["05/07/2026 10:03:30", "---", "Processing", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]
    return (MACHINE_HEADER + ",".join(row1) + "\n" + ",".join(row2) + "\n" + ",".join(row3) + "\n").encode("utf-8")


@pytest.fixture
def cloud_client(tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "data", duckdb_path=tmp_path / "data" / "processed" / "smoke.duckdb", batch_size=10, default_max_points=25)
    shared_store = DuckDBStore(settings.duckdb_path)

    def override_settings() -> Settings:
        return settings

    def override_store() -> DuckDBStore:
        return shared_store

    app.dependency_overrides[get_settings] = override_settings
    app.dependency_overrides[get_store] = override_store
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        shared_store.close()


def test_fastapi_synthetic_ingestion_smoke(cloud_client: TestClient):
    health = cloud_client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["backend"] == "ok"

    ingestion = cloud_client.post(
        "/api/v1/ingestions",
        files=[
            ("files", ("bss_part1.zip", io.BytesIO(_zip_bytes("bss1.csv", _bss_fixture())), "application/zip")),
            ("files", ("bss_current.csv", io.BytesIO(_bss_overlap_fixture()), "text/csv")),
            ("files", ("fec_part1.zip", io.BytesIO(_zip_bytes("fec1.csv", _fec_fixture())), "application/zip")),
            ("files", ("fec_current.csv", io.BytesIO(_fec_fixture()), "text/csv")),
            ("files", ("MachineStates.csv", io.BytesIO(_machine_states_fixture()), "text/csv")),
        ],
    )
    assert ingestion.status_code == 200, ingestion.text
    assert ingestion.json()["status"] == "completed"
    assert ingestion.json()["numeric_points_written"] == 8
    assert ingestion.json()["diagnostics_count"] >= 1
    ingestion_id = ingestion.json()["ingestion_id"]

    ingestion_status = cloud_client.get(f"/api/v1/ingestions/{ingestion_id}")
    assert ingestion_status.status_code == 200
    assert ingestion_status.json()["numeric_points_written"] == 8

    systems_response = cloud_client.get("/api/v1/systems")
    assert systems_response.status_code == 200
    systems = {system["system"] for system in systems_response.json()}
    assert {"BSS", "IPU", "IRD", "CWS"}.issubset(systems)

    signals_response = cloud_client.get("/api/v1/signals")
    assert signals_response.status_code == 200
    signals = signals_response.json()
    signal_names = {signal["signal_name"] for signal in signals}
    assert {"TubActualLevelMM", "FillActualTemperatureC", "IPU1 Pressure", "DRY1 PWM", "WaterInTemp"}.issubset(signal_names)
    assert all(".csv" not in name.lower() and ".dll" not in name.lower() for name in signal_names)

    bss_signal_id = next(signal["signal_id"] for signal in signals if signal["signal_name"] == "TubActualLevelMM")
    detail_response = cloud_client.get(f"/api/v1/signals/{bss_signal_id}")
    assert detail_response.status_code == 200
    components_response = cloud_client.get("/api/v1/systems/BSS/components")
    assert components_response.status_code == 200
    series_response = cloud_client.get(f"/api/v1/signals/{bss_signal_id}/series", params={"include_states": "true", "max_points": 2})
    assert series_response.status_code == 200
    series = series_response.json()
    assert series["total_point_count"] == 2
    assert series["returned_point_count"] <= 2
    assert series["points"]
    assert series["machine_state_intervals"]
    assert series["system_state_intervals"]

    states_response = cloud_client.get("/api/v1/states")
    assert states_response.status_code == 200
    assert states_response.json()
    diagnostics_response = cloud_client.get("/api/v1/diagnostics", params={"ingestion_id": ingestion_id, "code": "exact_duplicates_removed"})
    assert diagnostics_response.status_code == 200
    assert diagnostics_response.json()
