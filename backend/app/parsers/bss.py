from __future__ import annotations

from collections.abc import Iterator

from backend.app.models.domain import Diagnostic, SignalPoint, StateUpdate
from backend.app.parsers.common import clean_text, exact_headers, infer_unit, parse_number, parse_timestamp, stable_signal_id

BSS_HEADERS = ["Timestamp", "Action", "MessageType", "LLCIKey", "MachineType", "Component", "SubComponent", "ParameterType", "Value", "IsAlert"]


def is_bss(headers: list[str]) -> bool:
    return exact_headers(headers, BSS_HEADERS)


def parse_bss_rows(rows: Iterator[tuple[int, dict[str, str]]], *, press_id: str, source_file: str, ingestion_id: str | None = None) -> Iterator[SignalPoint | StateUpdate | Diagnostic]:
    for row_number, row in rows:
        ts = parse_timestamp(row.get("Timestamp"))
        if ts is None:
            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="invalid_timestamp", message="BSS row has invalid timestamp", source_file=source_file, row_number=row_number)
            continue
        action = clean_text(row.get("Action"))
        message_type = clean_text(row.get("MessageType"))
        component = clean_text(row.get("Component")) or "Unclassified"
        subcomponent = clean_text(row.get("SubComponent"))
        value = clean_text(row.get("Value"))
        if action == "StateMachine":
            state = value or subcomponent or component
            if state:
                yield StateUpdate(press_id=press_id, scope="machine", system=None, state=state, timestamp=ts, source=source_file)
            else:
                yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="missing_state", message="BSS StateMachine row did not contain a state", source_file=source_file, row_number=row_number)
            continue
        if action == "SubsystemState":
            state = value
            system = subcomponent or component or "BSS"
            if state:
                yield StateUpdate(press_id=press_id, scope="system", system="BSS" if component == "States" else system, state=state, timestamp=ts, source=source_file)
            else:
                yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="missing_state", message="BSS SubsystemState row did not contain a state", source_file=source_file, row_number=row_number)
            continue
        if message_type != "Parameter":
            yield Diagnostic(ingestion_id=ingestion_id, level="info", code="ignored_bss_row", message="BSS row is not a numeric Parameter sample", source_file=source_file, row_number=row_number)
            continue
        numeric = parse_number(value)
        if numeric is None:
            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="invalid_numeric", message="BSS Parameter value is not numeric", source_file=source_file, row_number=row_number, details={"component": component, "signal_name": subcomponent})
            continue
        signal_name = subcomponent or "Unclassified"
        signal_id = stable_signal_id(press_id, "bss", "BSS", component, component, signal_name)
        yield SignalPoint(press_id=press_id, source_type="bss", source_file=source_file, system="BSS", component=component, device=component, signal_id=signal_id, signal_name=signal_name, timestamp_utc_or_local=ts, numeric_value=numeric, unit=infer_unit(signal_name))
