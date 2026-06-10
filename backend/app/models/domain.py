from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal


class ModelMixin:
    def model_dump(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Diagnostic(ModelMixin):
    code: str
    message: str
    ingestion_id: str | None = None
    level: Literal["info", "warning", "error"] = "info"
    source_file: str | None = None
    row_number: int | None = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class SignalPoint(ModelMixin):
    press_id: str
    source_type: str
    source_file: str
    system: str
    component: str
    device: str
    signal_id: str
    signal_name: str
    timestamp_utc_or_local: datetime
    numeric_value: float
    unit: str | None = None
    machine_state: str | None = None
    system_state: str | None = None


@dataclass
class SignalDefinition(ModelMixin):
    signal_id: str
    system: str
    component: str
    device: str
    signal_name: str
    source_type: str
    unit: str | None = None
    first_timestamp: datetime | None = None
    last_timestamp: datetime | None = None
    sample_count: int = 0
    numeric_sample_count: int = 0


@dataclass
class StateUpdate(ModelMixin):
    press_id: str
    scope: Literal["machine", "system"]
    system: str | None
    state: str
    timestamp: datetime
    source: str


@dataclass
class StateInterval(ModelMixin):
    press_id: str
    scope: Literal["machine", "system"]
    system: str | None
    state: str
    start_timestamp: datetime
    end_timestamp: datetime | None = None
    duration_ms: int | None = None
    source: str = ""


@dataclass
class IngestionRun(ModelMixin):
    ingestion_id: str
    started_at: datetime
    status: str
    completed_at: datetime | None = None
    files_seen: int = 0
    files_parsed: int = 0
    rows_seen: int = 0
    numeric_points_written: int = 0
    state_updates_written: int = 0
    ignored_rows: int = 0
    invalid_rows: int = 0
    discovered_signals: int = 0
    diagnostics_count: int = 0


@dataclass
class SeriesPoint(ModelMixin):
    timestamp: datetime
    value: float
    machine_state: str | None = None
    system_state: str | None = None


@dataclass
class SeriesResponse(ModelMixin):
    total_point_count: int
    returned_point_count: int
    downsampled: bool
    latest: float | None
    minimum: float | None
    maximum: float | None
    average: float | None
    first_timestamp: datetime | None
    last_timestamp: datetime | None
    points: list[SeriesPoint]
    machine_state_intervals: list[StateInterval] = field(default_factory=list)
    system_state_intervals: list[StateInterval] = field(default_factory=list)
