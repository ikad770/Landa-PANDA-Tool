from __future__ import annotations

import re
from collections.abc import Iterator

from backend.app.models.domain import Diagnostic, SignalPoint, StateUpdate
from backend.app.parsers.common import clean_text, exact_headers, infer_unit, parse_number, parse_timestamp, stable_signal_id

FEC_HEADERS = ["Timestamp", "Type", "CableId", "PSSID", "SetPoint", "Enabled", "HasErrors", "HasWarnings", "PSCState", "Status", "State"]
PSSID_RE = re.compile(r"^(?P<name>.*?)(?:\((?P<id>\d+)\))?$")
IPU_RE = re.compile(r"^(IPU\d+)", re.I)
DRY_RE = re.compile(r"^(DRY\d+|AL\s*\d+|Ch\d+)", re.I)
CWS_NAMES = {"waterintemp", "waterouttemp", "cwssupplytemp", "cwsreturntemp"}


def is_fec(headers: list[str]) -> bool:
    return exact_headers(headers, FEC_HEADERS)


def parse_pssid(value: str) -> tuple[str, str | None]:
    text = clean_text(value)
    match = PSSID_RE.match(text)
    if not match:
        return text, None
    return clean_text(match.group("name")), match.group("id")


def infer_fec_group(signal_name: str) -> tuple[str, str]:
    direct = clean_text(signal_name)
    if direct in {"IPU", "IRD", "CWS", "Ventilation", "Dryer"}:
        return direct, direct
    compact = re.sub(r"[^a-z0-9]", "", signal_name.lower())
    ipu = IPU_RE.match(signal_name)
    if ipu:
        return "IPU", ipu.group(1).upper()
    dry = DRY_RE.match(signal_name)
    if dry:
        return "IRD", dry.group(1).replace(" ", "").upper()
    if compact in CWS_NAMES:
        return "CWS", "CWS"
    if "vent" in compact or "fan" in compact or "exhaust" in compact:
        return "Ventilation", "Ventilation"
    return "FEC", "Unclassified"


def parse_fec_rows(rows: Iterator[tuple[int, dict[str, str]]], *, press_id: str, source_file: str, ingestion_id: str | None = None) -> Iterator[SignalPoint | StateUpdate | Diagnostic]:
    for row_number, row in rows:
        ts = parse_timestamp(row.get("Timestamp"))
        if ts is None:
            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="invalid_timestamp", message="FEC row has invalid timestamp", source_file=source_file, row_number=row_number)
            continue
        row_type = clean_text(row.get("Type"))
        raw_pssid = clean_text(row.get("PSSID"))
        if row_type == "StateMachine":
            state = clean_text(row.get("State"))
            system, _component = infer_fec_group(raw_pssid)
            if state:
                yield StateUpdate(press_id=press_id, scope="system", system=system, state=state, timestamp=ts, source=source_file)
            else:
                yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="missing_state", message="FEC StateMachine row did not contain a state", source_file=source_file, row_number=row_number)
            continue
        if row_type not in {"DeviceStatus", "ControlStatus"}:
            yield Diagnostic(ingestion_id=ingestion_id, level="info", code="ignored_fec_row", message="FEC row type is not ingested as a signal sample", source_file=source_file, row_number=row_number)
            continue
        numeric = parse_number(row.get("SetPoint"))
        if numeric is None:
            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="invalid_numeric", message="FEC SetPoint is not numeric", source_file=source_file, row_number=row_number, details={"pssid": raw_pssid})
            continue
        signal_name, signal_source_id = parse_pssid(raw_pssid)
        system, component = infer_fec_group(signal_name)
        device = clean_text(row.get("CableId")) or component
        signal_id = stable_signal_id(press_id, "fec", system, component, device, signal_name)
        yield SignalPoint(press_id=press_id, source_type="fec", source_file=source_file, system=system, component=component, device=device, signal_id=signal_id, signal_name=signal_name, timestamp_utc_or_local=ts, numeric_value=numeric, unit=infer_unit(signal_name))
