from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.app.models.domain import Diagnostic, IngestionRun, SignalPoint, StateInterval, StateUpdate


def _dt(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    return value.isoformat(sep=" ") if isinstance(value, datetime) else value


def _parse(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    return value


class DuckDBStore:
    """DuckDB-facing storage API with a sqlite fallback for dependency-limited CI."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    def close(self) -> None:
        return None

    def initialize(self) -> None:
        with self.connection() as con:
            con.executescript("""
        CREATE TABLE IF NOT EXISTS ingestion_runs (
            ingestion_id TEXT PRIMARY KEY, started_at TEXT, completed_at TEXT, status TEXT,
            files_seen INTEGER, files_parsed INTEGER, rows_seen INTEGER, numeric_points_written INTEGER,
            state_updates_written INTEGER, ignored_rows INTEGER, invalid_rows INTEGER, discovered_signals INTEGER,
            diagnostics_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS signal_points (
            press_id TEXT, source_type TEXT, source_file TEXT, system TEXT, component TEXT,
            device TEXT, signal_id TEXT, signal_name TEXT, timestamp_utc_or_local TEXT,
            numeric_value REAL, unit TEXT, machine_state TEXT, system_state TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_points_signal_ts ON signal_points(signal_id, timestamp_utc_or_local);
        CREATE TABLE IF NOT EXISTS signal_catalog (
            signal_id TEXT PRIMARY KEY, system TEXT, component TEXT, device TEXT, signal_name TEXT,
            source_type TEXT, unit TEXT, first_timestamp TEXT, last_timestamp TEXT,
            sample_count INTEGER, numeric_sample_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS state_updates (
            press_id TEXT, scope TEXT, system TEXT, state TEXT, timestamp TEXT, source TEXT
        );
        CREATE TABLE IF NOT EXISTS state_intervals (
            press_id TEXT, scope TEXT, system TEXT, state TEXT, start_timestamp TEXT,
            end_timestamp TEXT, duration_ms INTEGER, source TEXT
        );
        CREATE TABLE IF NOT EXISTS ingestion_diagnostics (
            ingestion_id TEXT, level TEXT, code TEXT, message TEXT, source_file TEXT,
            row_number INTEGER, details TEXT
        );
        CREATE TABLE IF NOT EXISTS non_numeric_events (
            ingestion_id TEXT, source_file TEXT, timestamp_utc_or_local TEXT, source_type TEXT,
            system TEXT, component TEXT, signal_name TEXT, value TEXT
        );
        """)
            con.commit()

    def create_run(self, run: IngestionRun) -> None:
        data = run.model_dump()
        vals = (data["ingestion_id"], _dt(data["started_at"]), _dt(data["completed_at"]), data["status"], data["files_seen"], data["files_parsed"], data["rows_seen"], data["numeric_points_written"], data["state_updates_written"], data["ignored_rows"], data["invalid_rows"], data["discovered_signals"], data["diagnostics_count"])
        with self.connection() as con:
            con.execute("INSERT OR REPLACE INTO ingestion_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", vals)
            con.commit()

    update_run = create_run

    def get_run(self, ingestion_id: str) -> dict[str, Any] | None:
        with self.connection() as con:
            row = con.execute("SELECT * FROM ingestion_runs WHERE ingestion_id = ?", [ingestion_id]).fetchone()
            return dict(row) if row else None

    def insert_points(self, points: list[SignalPoint]) -> None:
        if points:
            with self.connection() as con:
                con.executemany("INSERT INTO signal_points VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [(p.press_id, p.source_type, p.source_file, p.system, p.component, p.device, p.signal_id, p.signal_name, _dt(p.timestamp_utc_or_local), p.numeric_value, p.unit, p.machine_state, p.system_state) for p in points])
                con.commit()

    def insert_state_updates(self, updates: list[StateUpdate]) -> None:
        if updates:
            with self.connection() as con:
                con.executemany("INSERT INTO state_updates VALUES (?, ?, ?, ?, ?, ?)", [(u.press_id, u.scope, u.system, u.state, _dt(u.timestamp), u.source) for u in updates])
                con.commit()

    def insert_diagnostics(self, diagnostics: list[Diagnostic]) -> None:
        if diagnostics:
            with self.connection() as con:
                con.executemany("INSERT INTO ingestion_diagnostics VALUES (?, ?, ?, ?, ?, ?, ?)", [(d.ingestion_id, d.level, d.code, d.message, d.source_file, d.row_number, json.dumps(d.details)) for d in diagnostics])
                con.commit()

    def rebuild_catalog(self) -> None:
        with self.connection() as con:
            con.execute("DELETE FROM signal_catalog")
            con.execute("""
            INSERT OR REPLACE INTO signal_catalog
            SELECT signal_id, min(system), min(component), min(device), min(signal_name), min(source_type), min(unit),
                   min(timestamp_utc_or_local), max(timestamp_utc_or_local), count(*), count(*)
            FROM signal_points GROUP BY signal_id
            """)
            con.commit()

    def rebuild_state_intervals(self) -> None:
        with self.connection() as con:
            con.execute("DELETE FROM state_intervals")
            rows = con.execute("SELECT press_id, scope, system, state, timestamp, source FROM state_updates ORDER BY press_id, scope, coalesce(system, ''), timestamp").fetchall()
            intervals: list[tuple[Any, ...]] = []
            last_key = None
            active = None
            for row in rows:
                press_id, scope, system, state, ts_text, source = tuple(row)
                ts = datetime.fromisoformat(ts_text)
                key = (press_id, scope, system)
                if key != last_key:
                    if active:
                        intervals.append((active[0], active[1], active[2], active[3], _dt(active[4]), None, None, active[5]))
                    active = (press_id, scope, system, state, ts, source)
                    last_key = key
                    continue
                if active and active[3] == state:
                    continue
                if active:
                    duration = int((ts - active[4]).total_seconds() * 1000)
                    if duration > 0:
                        intervals.append((active[0], active[1], active[2], active[3], _dt(active[4]), _dt(ts), duration, active[5]))
                active = (press_id, scope, system, state, ts, source)
            if active:
                intervals.append((active[0], active[1], active[2], active[3], _dt(active[4]), None, None, active[5]))
            if intervals:
                con.executemany("INSERT INTO state_intervals VALUES (?, ?, ?, ?, ?, ?, ?, ?)", intervals)
            con.commit()

    def align_points_with_states(self) -> None:
        with self.connection() as con:
            con.execute("""
            UPDATE signal_points SET machine_state = (
              SELECT state FROM state_intervals i WHERE i.press_id=signal_points.press_id AND i.scope='machine'
              AND signal_points.timestamp_utc_or_local >= i.start_timestamp AND (i.end_timestamp IS NULL OR signal_points.timestamp_utc_or_local < i.end_timestamp)
              ORDER BY i.start_timestamp DESC LIMIT 1)
            """)
            con.execute("""
            UPDATE signal_points SET system_state = (
              SELECT state FROM state_intervals i WHERE i.press_id=signal_points.press_id AND i.scope='system' AND i.system=signal_points.system
              AND signal_points.timestamp_utc_or_local >= i.start_timestamp AND (i.end_timestamp IS NULL OR signal_points.timestamp_utc_or_local < i.end_timestamp)
              ORDER BY i.start_timestamp DESC LIMIT 1)
            """)
            con.commit()

    def count_catalog(self) -> int:
        with self.connection() as con:
            return int(con.execute("SELECT count(*) FROM signal_catalog").fetchone()[0])

    def count_diagnostics(self, ingestion_id: str) -> int:
        with self.connection() as con:
            return int(con.execute("SELECT count(*) FROM ingestion_diagnostics WHERE ingestion_id = ?", [ingestion_id]).fetchone()[0])

    def count_points(self) -> int:
        with self.connection() as con:
            return int(con.execute("SELECT count(*) FROM signal_points").fetchone()[0])

    def health(self) -> dict[str, Any]:
        with self.connection() as con:
            con.execute("SELECT 1").fetchone()
        return {"database": "ok", "path": str(self.path), "engine": "sqlite-compatible-duckdb-api"}

    def list_systems(self) -> list[dict[str, Any]]:
        with self.connection() as con:
            return [dict(r) for r in con.execute("SELECT system, count(DISTINCT signal_id) AS signal_count, sum(sample_count) AS sample_count FROM signal_catalog GROUP BY system ORDER BY system").fetchall()]

    def list_components(self, system: str) -> list[dict[str, Any]]:
        with self.connection() as con:
            return [dict(r) for r in con.execute("SELECT component, count(DISTINCT signal_id) AS signal_count, sum(sample_count) AS sample_count FROM signal_catalog WHERE system = ? GROUP BY component ORDER BY component", [system]).fetchall()]

    def list_signals(self, system: str | None = None, component: str | None = None, source_type: str | None = None, search: str | None = None, start: datetime | None = None, end: datetime | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if system: clauses.append("system = ?"); params.append(system)
        if component: clauses.append("component = ?"); params.append(component)
        if source_type: clauses.append("source_type = ?"); params.append(source_type)
        if search: clauses.append("lower(signal_name) LIKE ?"); params.append(f"%{search.lower()}%")
        if start: clauses.append("last_timestamp >= ?"); params.append(_dt(start))
        if end: clauses.append("first_timestamp <= ?"); params.append(_dt(end))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connection() as con:
            return [dict(r) for r in con.execute(f"SELECT * FROM signal_catalog{where} ORDER BY system, component, signal_name LIMIT 1000", params).fetchall()]

    def get_signal(self, signal_id: str) -> dict[str, Any] | None:
        with self.connection() as con:
            row = con.execute("SELECT * FROM signal_catalog WHERE signal_id = ?", [signal_id]).fetchone()
            return dict(row) if row else None

    def series(self, signal_id: str, max_points: int, start: datetime | None = None, end: datetime | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        clauses = ["signal_id = ?"]
        params: list[Any] = [signal_id]
        if start: clauses.append("timestamp_utc_or_local >= ?"); params.append(_dt(start))
        if end: clauses.append("timestamp_utc_or_local <= ?"); params.append(_dt(end))
        where = " AND ".join(clauses)
        with self.connection() as con:
            row = con.execute(f"SELECT count(*), min(numeric_value), max(numeric_value), avg(numeric_value), min(timestamp_utc_or_local), max(timestamp_utc_or_local) FROM signal_points WHERE {where}", params).fetchone()
            total, minimum, maximum, average, first_ts, last_ts = tuple(row)
            if not total:
                return {"total": 0, "minimum": None, "maximum": None, "average": None, "latest": None, "first": None, "last": None}, []
            latest = con.execute(f"SELECT numeric_value FROM signal_points WHERE {where} ORDER BY timestamp_utc_or_local DESC LIMIT 1", params).fetchone()[0]
            all_rows = con.execute(f"SELECT timestamp_utc_or_local AS timestamp, numeric_value AS value, machine_state, system_state FROM signal_points WHERE {where} ORDER BY timestamp_utc_or_local", params).fetchall()
        if len(all_rows) > max_points:
            step = max(1, len(all_rows) // max_points)
            picked = [all_rows[0], all_rows[-1]] + [r for idx, r in enumerate(all_rows) if idx % step == 0]
            min_r = min(all_rows, key=lambda r: r["value"]); max_r = max(all_rows, key=lambda r: r["value"])
            uniq = {(r["timestamp"], r["value"]): r for r in [*picked, min_r, max_r]}
            selected = sorted(uniq.values(), key=lambda r: r["timestamp"])[:max_points]
        else:
            selected = all_rows
        return {"total": total, "minimum": minimum, "maximum": maximum, "average": average, "latest": latest, "first": _parse(first_ts), "last": _parse(last_ts)}, [{"timestamp": _parse(r["timestamp"]), "value": r["value"], "machine_state": r["machine_state"], "system_state": r["system_state"]} for r in selected]

    def intervals(self, system: str | None = None, start: datetime | None = None, end: datetime | None = None) -> list[StateInterval]:
        clauses: list[str] = []
        params: list[Any] = []
        if system:
            if system == "Machine": clauses.append("scope = 'machine'")
            else: clauses.append("scope = 'system' AND system = ?"); params.append(system)
        if start: clauses.append("(end_timestamp IS NULL OR end_timestamp >= ?)"); params.append(_dt(start))
        if end: clauses.append("start_timestamp <= ?"); params.append(_dt(end))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connection() as con:
            rows = con.execute(f"SELECT * FROM state_intervals{where} ORDER BY start_timestamp", params).fetchall()
            return [StateInterval(press_id=r["press_id"], scope=r["scope"], system=r["system"], state=r["state"], start_timestamp=_parse(r["start_timestamp"]), end_timestamp=_parse(r["end_timestamp"]), duration_ms=r["duration_ms"], source=r["source"]) for r in rows]

    def diagnostics(self, ingestion_id: str | None = None, level: str | None = None, source_file: str | None = None, code: str | None = None) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        for col, val in [("ingestion_id", ingestion_id), ("level", level), ("source_file", source_file), ("code", code)]:
            if val: clauses.append(f"{col} = ?"); params.append(val)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connection() as con:
            return [dict(r) for r in con.execute(f"SELECT * FROM ingestion_diagnostics{where} ORDER BY row_number LIMIT 1000", params).fetchall()]
