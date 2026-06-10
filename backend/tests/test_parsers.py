from __future__ import annotations

from backend.app.models.domain import Diagnostic, SignalPoint, StateUpdate
from backend.app.parsers.bss import BSS_HEADERS, is_bss, parse_bss_rows
from backend.app.parsers.common import parse_timestamp
from backend.app.parsers.fec import FEC_HEADERS, infer_fec_group, is_fec, parse_fec_rows, parse_pssid
from backend.app.parsers.machine_states import MACHINE_STATES_HEADERS, is_machine_states, parse_machine_state_rows


def test_timestamp_cleanup_and_deterministic_dd_mm():
    assert parse_timestamp("\ufeff05/07/2026 16:19:44:544139\ufffd").month == 7
    assert parse_timestamp("07/05/2026 08:29:35.474").day == 7
    assert parse_timestamp("07/05/2026 08:29:35").second == 35
    assert parse_timestamp("2026-05-07") is None


def test_bss_parser_mapping_zero_state_and_filename_not_signal():
    assert is_bss(BSS_HEADERS)
    rows = iter([
        (2, {"Timestamp":"05/07/2026 16:19:44:544139","Action":"","MessageType":"Parameter","LLCIKey":"k1","MachineType":"S10","Component":"BCUMonitor","SubComponent":"TubActualLevelMM","ParameterType":"Double","Value":"0","IsAlert":"False"}),
        (3, {"Timestamp":"05/07/2026 16:19:45:000000","Action":"StateMachine","MessageType":"","LLCIKey":"","MachineType":"","Component":"","SubComponent":"","ParameterType":"","Value":"Printing","IsAlert":""}),
        (4, {"Timestamp":"05/07/2026 16:19:46:000000","Action":"SubsystemState","MessageType":"","LLCIKey":"","MachineType":"","Component":"States","SubComponent":"BSS","ParameterType":"","Value":"Ready","IsAlert":""}),
        (5, {"Timestamp":"05/07/2026 16:19:47:000000","Action":"","MessageType":"Parameter","LLCIKey":"k2","MachineType":"S10","Component":"BCUMonitor","SubComponent":"FillActualTemperatureC","ParameterType":"Double","Value":"bad","IsAlert":"False"}),
    ])
    parsed = list(parse_bss_rows(rows, press_id="p", source_file="BSSNotifications.dll.csv"))
    point = next(item for item in parsed if isinstance(item, SignalPoint))
    assert point.system == "BSS"
    assert point.component == "BCUMonitor"
    assert point.signal_name == "TubActualLevelMM"
    assert point.numeric_value == 0
    assert "dll" not in point.signal_name.lower()
    states = [item for item in parsed if isinstance(item, StateUpdate)]
    assert [(s.scope, s.system, s.state) for s in states] == [("machine", None, "Printing"), ("system", "BSS", "Ready")]
    assert any(isinstance(item, Diagnostic) and item.code == "invalid_numeric" for item in parsed)


def test_fec_parser_mapping_groups_and_filename_not_signal():
    assert is_fec(FEC_HEADERS)
    assert parse_pssid("IPU1 Pressure(12345)") == ("IPU1 Pressure", "12345")
    assert infer_fec_group("IPU6 Vacuum") == ("IPU", "IPU6")
    assert infer_fec_group("DRY1 PWM") == ("IRD", "DRY1")
    assert infer_fec_group("AL 1 Temp") == ("IRD", "AL1")
    assert infer_fec_group("Ch1PeakCurrent") == ("IRD", "CH1")
    assert infer_fec_group("WaterInTemp") == ("CWS", "CWS")
    rows = iter([
        (2, {"Timestamp":"07/05/2026 08:29:35.474","Type":"ControlStatus","CableId":"CableA","PSSID":"IPU1 Pressure(12345)","SetPoint":"12.5","Enabled":"True","HasErrors":"False","HasWarnings":"False","PSCState":"On","Status":"0","State":""}),
        (3, {"Timestamp":"07/05/2026 08:29:36.474","Type":"StateMachine","CableId":"","PSSID":"IPU","SetPoint":"","Enabled":"","HasErrors":"","HasWarnings":"","PSCState":"","Status":"","State":"Running"}),
    ])
    parsed = list(parse_fec_rows(rows, press_id="p", source_file="FECNotifications.dll.csv"))
    point = next(item for item in parsed if isinstance(item, SignalPoint))
    assert point.system == "IPU"
    assert point.component == "IPU1"
    assert point.device == "CableA"
    assert point.signal_name == "IPU1 Pressure"
    assert point.numeric_value == 12.5
    assert "12345" not in point.signal_name
    assert "dll" not in point.signal_name.lower()
    assert any(isinstance(item, StateUpdate) and item.system == "IPU" and item.state == "Running" for item in parsed)


def test_machine_states_carry_forward_independent_and_duplicates_removed():
    assert is_machine_states(MACHINE_STATES_HEADERS)
    rows = iter([
        (2, {"Time":"05/07/2026 10:00:00", "Machine":"Idle", "BSS":"Ready", "IPU":"---"}),
        (3, {"Time":"05/07/2026 10:01:00", "Machine":"---", "BSS":"---", "IPU":"Running"}),
        (4, {"Time":"05/07/2026 10:02:00", "Machine":"Idle", "BSS":"Ready", "IPU":"---"}),
        (5, {"Time":"bad", "Machine":"Printing", "BSS":"---", "IPU":"---"}),
    ])
    parsed = list(parse_machine_state_rows(rows, press_id="p", source_file="MachineStates.csv"))
    updates = [p for p in parsed if isinstance(p, StateUpdate)]
    assert [(u.scope, u.system, u.state) for u in updates] == [("machine", None, "Idle"), ("system", "BSS", "Ready"), ("system", "IPU", "Running")]
    assert any(isinstance(p, Diagnostic) and p.code == "invalid_timestamp" for p in parsed)
