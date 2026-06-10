from __future__ import annotations

from collections.abc import Iterator

from backend.app.models.domain import Diagnostic, StateUpdate
from backend.app.parsers.common import clean_text, exact_headers, parse_timestamp

MACHINE_STATE_COLUMNS = ["Machine", "BSS", "IPS", "PSS", "Dryer", "IPU", "Ventilation", "CWS", "IRD", "DFES", "DPS", "QCS", "ICS", "ECS", "MSPS", "ITS"]
MACHINE_STATES_HEADERS = ["Time", *MACHINE_STATE_COLUMNS]
NO_CHANGE = "---"


def is_machine_states(headers: list[str]) -> bool:
    return exact_headers(headers, MACHINE_STATES_HEADERS)


def parse_machine_state_rows(rows: Iterator[tuple[int, dict[str, str]]], *, press_id: str, source_file: str, ingestion_id: str | None = None) -> Iterator[StateUpdate | Diagnostic]:
    current: dict[str, str | None] = {column: None for column in MACHINE_STATE_COLUMNS}
    for row_number, row in rows:
        ts = parse_timestamp(row.get("Time"))
        if ts is None:
            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="invalid_timestamp", message="MachineStates row has invalid timestamp", source_file=source_file, row_number=row_number)
            continue
        for column in MACHINE_STATE_COLUMNS:
            raw = clean_text(row.get(column))
            if not raw or raw == NO_CHANGE:
                continue
            if current[column] == raw:
                continue
            current[column] = raw
            yield StateUpdate(press_id=press_id, scope="machine" if column == "Machine" else "system", system=None if column == "Machine" else column, state=raw, timestamp=ts, source=source_file)
