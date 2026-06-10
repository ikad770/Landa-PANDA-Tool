from __future__ import annotations

import io
from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient

from backend.app.api.v1 import get_settings
from backend.app.core.config import Settings
from backend.app.main import app
from backend.tests.conftest import BSS_HEADER, FEC_HEADER, MACHINE_HEADER


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

    def override_settings() -> Settings:
        return settings

    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_fastapi_synthetic_ingestion_smoke(cloud_client: TestClient):
    health = cloud_client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["backend"] == "ok"

    ingestion = cloud_client.post(
        "/api/v1/ingestions",
        files=[
            ("files", ("bss.csv", io.BytesIO(_bss_fixture()), "text/csv")),
            ("files", ("fec.csv", io.BytesIO(_fec_fixture()), "text/csv")),
            ("files", ("MachineStates.csv", io.BytesIO(_machine_states_fixture()), "text/csv")),
        ],
    )
    assert ingestion.status_code == 200, ingestion.text
    assert ingestion.json()["status"] == "completed"

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
    series_response = cloud_client.get(f"/api/v1/signals/{bss_signal_id}/series", params={"include_states": "true", "max_points": 10})
    assert series_response.status_code == 200
    series = series_response.json()
    assert series["total_point_count"] == 2
    assert series["returned_point_count"] == 2
    assert series["points"]
    assert series["machine_state_intervals"]
    assert series["system_state_intervals"]
