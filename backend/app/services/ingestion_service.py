from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

from backend.app.core.config import Settings
from backend.app.ingestion.archive_reader import ArchiveLimits, TextEntry, iter_entries
from backend.app.models.domain import Diagnostic, IngestionRun, SignalPoint, StateUpdate
from backend.app.parsers.bss import is_bss, parse_bss_rows
from backend.app.parsers.common import read_csv_dicts
from backend.app.parsers.fec import is_fec, parse_fec_rows
from backend.app.parsers.machine_states import is_machine_states, parse_machine_state_rows
from backend.app.services.signal_catalog import refresh_signal_catalog
from backend.app.services.state_service import rebuild_and_align_states
from backend.app.storage.duckdb_store import DuckDBStore
from backend.app.storage.parquet_store import ParquetStore

logger = logging.getLogger("panda.ingestion")


class IngestionService:
    def __init__(self, store: DuckDBStore, settings: Settings):
        self.store = store
        self.settings = settings

    def ingest_paths(self, paths: Iterable[str | Path], *, press_id: str = "default") -> IngestionRun:
        started = datetime.now(UTC)
        ingestion_id = uuid.uuid4().hex
        run = IngestionRun(ingestion_id=ingestion_id, started_at=started, status="running")
        self.store.create_run(run)
        limits = ArchiveLimits(
            max_depth=self.settings.max_archive_depth,
            max_files=self.settings.max_archive_files,
            max_uncompressed_bytes=self.settings.max_uncompressed_mb * 1024 * 1024,
        )
        points: list[SignalPoint] = []
        states: list[StateUpdate] = []
        diagnostics: list[Diagnostic] = []
        t0 = time.perf_counter()

        def flush() -> None:
            nonlocal points, states, diagnostics
            if points:
                self.store.insert_points(points)
                run.numeric_points_written += len(points)
                points = []
            if states:
                self.store.insert_state_updates(states)
                run.state_updates_written += len(states)
                states = []
            if diagnostics:
                self.store.insert_diagnostics(diagnostics)
                run.diagnostics_count += len(diagnostics)
                diagnostics = []

        try:
            for item in iter_entries([str(p) for p in paths], limits, ingestion_id=ingestion_id):
                if isinstance(item, Diagnostic):
                    diagnostics.append(item)
                    if len(diagnostics) >= self.settings.batch_size:
                        flush()
                    continue
                assert isinstance(item, TextEntry)
                run.files_seen += 1
                headers, rows = read_csv_dicts(item.text)
                if not headers:
                    diagnostics.append(Diagnostic(ingestion_id=ingestion_id, level="warning", code="empty_file", message="File has no header row", source_file=item.name))
                    continue
                if is_bss(headers):
                    parser = parse_bss_rows(rows, press_id=press_id, source_file=item.name, ingestion_id=ingestion_id)
                    schema = "bss"
                elif is_fec(headers):
                    parser = parse_fec_rows(rows, press_id=press_id, source_file=item.name, ingestion_id=ingestion_id)
                    schema = "fec"
                elif is_machine_states(headers):
                    parser = parse_machine_state_rows(rows, press_id=press_id, source_file=item.name, ingestion_id=ingestion_id)
                    schema = "machine_states"
                else:
                    diagnostics.append(Diagnostic(ingestion_id=ingestion_id, level="info", code="unsupported_schema", message="Exact source schema was not recognized", source_file=item.name, details={"headers": headers[:20]}))
                    continue
                diagnostics.append(Diagnostic(ingestion_id=ingestion_id, level="info", code="schema_detected", message=f"Detected {schema} schema", source_file=item.name))
                run.files_parsed += 1
                for parsed in parser:
                    if isinstance(parsed, SignalPoint):
                        points.append(parsed)
                        run.rows_seen += 1
                    elif isinstance(parsed, StateUpdate):
                        states.append(parsed)
                        run.rows_seen += 1
                    else:
                        diagnostics.append(parsed)
                        if parsed.code in {"invalid_timestamp", "invalid_numeric", "missing_state"}:
                            run.invalid_rows += 1
                        elif parsed.code.startswith("ignored"):
                            run.ignored_rows += 1
                    if len(points) + len(states) + len(diagnostics) >= self.settings.batch_size:
                        flush()
                flush()
            flush()
            rebuild_and_align_states(self.store)
            refresh_signal_catalog(self.store)
            run.discovered_signals = int(self.store.con.execute("SELECT count(*) FROM signal_catalog").fetchone()[0])
            try:
                ParquetStore(self.settings.processed_dir).export_signal_points(self.store)
            except Exception as exc:  # pragma: no cover - defensive optional export diagnostic
                self.store.insert_diagnostics([Diagnostic(ingestion_id=ingestion_id, level="warning", code="parquet_export_failed", message=str(exc))])
                run.diagnostics_count += 1
            run.status = "completed"
        except Exception as exc:
            run.status = "failed"
            diagnostics.append(Diagnostic(ingestion_id=ingestion_id, level="error", code="ingestion_failed", message=str(exc)))
            flush()
            raise
        finally:
            run.completed_at = datetime.now(UTC)
            run.diagnostics_count = int(self.store.con.execute("SELECT count(*) FROM ingestion_diagnostics WHERE ingestion_id = ?", [ingestion_id]).fetchone()[0])
            self.store.update_run(run)
            duration_ms = int((time.perf_counter() - t0) * 1000)
            logger.info("ingestion completed", extra={"ingestion_id": ingestion_id, "stage": run.status, "files": run.files_seen, "rows": run.rows_seen, "written_points": run.numeric_points_written, "diagnostics_count": run.diagnostics_count, "duration_ms": duration_ms})
        return run
