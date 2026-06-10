from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from backend.app.tools.validate_real_data import discover_files, resolve_autocollect, suspicious_signal_name
from backend.tests.conftest import BSS_HEADER, FEC_HEADER, MACHINE_HEADER, make_zip


def _bss_rows(*rows: str) -> str:
    return BSS_HEADER + "\n".join(rows) + "\n"


def _fec_rows(*rows: str) -> str:
    return FEC_HEADER + "\n".join(rows) + "\n"


def _machine_rows(*rows: list[str]) -> str:
    return MACHINE_HEADER + "".join(",".join(row) + "\n" for row in rows)


def build_autocollect_fixture(root: Path) -> dict[str, Path]:
    bss = root / "OPC" / "Logs" / "LLCINotifications" / "BSS"
    fec = root / "OPC" / "Logs" / "FECNotifications"
    machine = root / "OPC" / "Logs" / "MachineStates"
    bss.mkdir(parents=True)
    fec.mkdir(parents=True)
    machine.mkdir(parents=True)
    make_zip(bss / "BSSNotifications_1.ZIP", {"part1.csv": _bss_rows(
        "05/07/2026 10:02:00,,Parameter,k2,S10,BCUMonitor,SharedTimestampSignal,Double,2,False",
        "05/07/2026 10:00:00,,Parameter,k1,S10,BCUMonitor,TubActualLevelMM,Double,1,False",
    )})
    make_zip(bss / "BSSNotifications_2.zip", {"part2.csv": _bss_rows(
        "05/07/2026 10:01:00,,Parameter,k1,S10,BCUMonitor,TubActualLevelMM,Double,1.5,False",
        "05/07/2026 10:02:00,,Parameter,k2,S10,BCUMonitor,SharedTimestampSignal,Double,2,False",
    )})
    (bss / "BSSNotifications_current.csv").write_text(_bss_rows(
        "05/07/2026 10:02:00,,Parameter,k2,S10,BCUMonitor,SharedTimestampSignal,Double,2,False",
        "05/07/2026 10:02:00,,Parameter,k3,S10,BCUMonitor,DifferentSignalSameTimestamp,Double,2,False",
        "05/07/2026 10:02:00,,Parameter,k2,S10,BCUMonitor,SharedTimestampSignal,Double,3,False",
        "05/07/2026 10:03:00,,StateMachine,k4,S10,States,MachineState,String,Printing,False",
    ), encoding="utf-8")
    (bss / "~$office.csv").write_text("ignored", encoding="utf-8")
    (bss / "notes.xlsx").write_text("unsupported", encoding="utf-8")
    make_zip(fec / "FECNotifications_1.zip", {"fec1.csv": _fec_rows(
        "05/07/2026 10:00:00,ControlStatus,CableA,IPU1 Pressure(12345),10,True,False,False,On,0,",
        "05/07/2026 10:01:00,DeviceStatus,CableB,DRY1 PWM(222),30,True,False,False,On,0,",
    )})
    make_zip(fec / "FECNotifications_2.zip", {"fec2.csv": _fec_rows(
        "05/07/2026 10:01:00,DeviceStatus,CableB,DRY1 PWM(222),30,True,False,False,On,0,",
        "05/07/2026 10:02:00,DeviceStatus,CableC,WaterOutTemp(88),20,True,False,False,On,0,",
    )})
    (fec / "FECNotifications_current.csv").write_text(_fec_rows(
        "05/07/2026 10:03:00,DeviceStatus,CableD,Ventilation Fan(99),40,True,False,False,On,0,",
        "05/07/2026 10:04:00,DeviceStatus,CableE,MysteryThing(77),50,True,False,False,On,0,",
    ), encoding="utf-8")
    blanks = ["---"] * 16
    (machine / "MachineStates.2026-07-05.csv").write_text(_machine_rows(
        ["05/07/2026 09:59:00", "Idle", "Ready", *blanks[2:]],
        ["05/07/2026 10:01:30", "Printing", "---", "---", "---", "---", "Running", "Running", "Running", "Running", *blanks[9:]],
    ), encoding="utf-8")
    (machine / "MachineStates.2026-07-06.csv").write_text(_machine_rows(
        ["05/07/2026 10:02:30", "---", "Processing", *blanks[2:]],
        ["05/07/2026 10:02:30", "---", "Processing", *blanks[2:]],
    ), encoding="utf-8")
    return {"bss": bss, "fec": fec, "machine": machine}


def run_cli(tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PANDA_DATA_DIR"] = str(tmp_path / "runtime")
    env["PANDA_DUCKDB_PATH"] = str(tmp_path / "runtime" / "processed" / "panda.duckdb")
    return subprocess.run([sys.executable, "-m", "backend.app.tools.validate_real_data", *args], cwd=Path(__file__).parents[2], env=env, text=True, capture_output=True, timeout=60)


def test_autocollect_discovery_root_opc_and_case_insensitive(tmp_path: Path):
    dirs = build_autocollect_fixture(tmp_path / "AutoCollect")
    resolved, diagnostics = resolve_autocollect(tmp_path / "AutoCollect")
    assert not diagnostics
    assert resolved["bss"] == dirs["bss"]
    resolved_from_opc, diagnostics = resolve_autocollect(tmp_path / "AutoCollect" / "OPC")
    assert not diagnostics
    assert resolved_from_opc["fec"] == dirs["fec"]
    upper = tmp_path / "Mixed"
    (upper / "opc" / "LOGS" / "llcinotifications" / "bss").mkdir(parents=True)
    (upper / "opc" / "LOGS" / "fecnotifications").mkdir(parents=True)
    (upper / "opc" / "LOGS" / "machinestates").mkdir(parents=True)
    resolved_mixed, diagnostics = resolve_autocollect(upper)
    assert not diagnostics
    assert resolved_mixed["bss"].name == "bss"


def test_discover_files_ignores_temp_hidden_nested_and_reports_unsupported(tmp_path: Path):
    source = tmp_path / "BSS"
    source.mkdir()
    (source / "a.csv").write_text("", encoding="utf-8")
    (source / "b.ZIP").write_text("", encoding="utf-8")
    (source / "~$a.csv").write_text("", encoding="utf-8")
    (source / ".DS_Store").write_text("", encoding="utf-8")
    (source / "nested").mkdir()
    (source / "book.xlsx").write_text("", encoding="utf-8")
    found = discover_files("bss", source)
    assert [Path(p).name for p in found["files"]] == ["a.csv", "b.ZIP"]
    assert len(found["unsupported_files"]) == 1
    assert len(found["ignored_entries"]) == 3


def test_cli_pass_multifile_autocollect_dedup_json_and_reset(tmp_path: Path):
    root = tmp_path / "autocollect-v8"
    build_autocollect_fixture(root)
    report = tmp_path / "runtime" / "validation" / "report.json"
    result = run_cli(tmp_path, "--autocollect-root", str(root), "--press-id", "D14", "--json-output", str(report), "--max-series-points", "2", "--reset-runtime-data")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PANDA REAL-DATA VALIDATION: PASS" in result.stdout
    data = json.loads(report.read_text(encoding="utf-8"))
    assert report.stat().st_size < data["metadata"]["json_size_limit_bytes"]
    assert data["ingestion"]["duplicates_removed"]["signal_points"] >= 2
    assert data["time_coverage"]["machine_state_interval_count"] >= 1
    systems = {s["system"] for s in data["system_summaries"]}
    assert {"BSS", "IPU", "IRD", "CWS", "Ventilation", "FEC"}.issubset(systems)
    assert all("points" not in item for item in data["series_validations"])
    text = report.read_text(encoding="utf-8")
    assert "TubActualLevelMM,Double" not in text
    assert all(item["returned_point_count"] <= 2 for item in data["series_validations"])


def test_cli_explicit_selected_sources_and_fail_cases(tmp_path: Path):
    root = tmp_path / "autocollect-v8"
    dirs = build_autocollect_fixture(root)
    ok = run_cli(tmp_path, "--bss-dir", str(dirs["bss"]), "--press-id", "D14")
    assert ok.returncode == 0, ok.stdout + ok.stderr
    missing = run_cli(tmp_path, "--bss-dir", str(tmp_path / "missing"), "--press-id", "D14")
    assert missing.returncode != 0
    assert "PANDA REAL-DATA VALIDATION: FAIL" in missing.stdout
    no_input = run_cli(tmp_path, "--press-id", "D14")
    assert no_input.returncode != 0


def test_cli_suspicious_signal_failure_zero_numeric_missing_machine_and_unclassified(tmp_path: Path):
    assert suspicious_signal_name("Spitfire.Server.Modules.Bad")
    bad_bss = tmp_path / "bad_bss"
    bad_bss.mkdir()
    (bad_bss / "bad.csv").write_text(_bss_rows("05/07/2026 10:00:00,,Parameter,k1,S10,BCU,module.dll,Double,1,False"), encoding="utf-8")
    bad = run_cli(tmp_path, "--bss-dir", str(bad_bss), "--press-id", "D14")
    assert bad.returncode != 0
    assert "suspicious" in bad.stdout
    zero = tmp_path / "zero"
    zero.mkdir()
    (zero / "zero.csv").write_text(_bss_rows("05/07/2026 10:00:00,,Event,k1,S10,BCU,NotNumeric,Double,abc,False"), encoding="utf-8")
    zero_result = run_cli(tmp_path, "--bss-dir", str(zero), "--press-id", "D14", "--reset-runtime-data")
    assert zero_result.returncode != 0
    machine = tmp_path / "machine"
    machine.mkdir()
    blanks = ["---"] * 16
    (machine / "MachineStates.csv").write_text(_machine_rows(["05/07/2026 10:00:00", *blanks]), encoding="utf-8")
    machine_result = run_cli(tmp_path, "--machine-states-dir", str(machine), "--press-id", "D14", "--reset-runtime-data")
    assert machine_result.returncode != 0
    unclass = tmp_path / "unclass"
    unclass.mkdir()
    (unclass / "fec.csv").write_text(_fec_rows("05/07/2026 10:00:00,ControlStatus,CableA,MysteryThing(123),1,True,False,False,On,0,"), encoding="utf-8")
    unclass_result = run_cli(tmp_path, "--fec-dir", str(unclass), "--press-id", "D14", "--reset-runtime-data")
    assert unclass_result.returncode != 0
    assert "Unclassified" in unclass_result.stdout
