from __future__ import annotations

from pathlib import Path

from backend.app.storage.duckdb_store import DuckDBStore


class ParquetStore:
    """Exports compact normalized partitions under data/processed when requested."""

    def __init__(self, processed_dir: Path):
        self.processed_dir = processed_dir
        self.series_dir = processed_dir / "series_parquet"
        self.series_dir.mkdir(parents=True, exist_ok=True)

    def export_signal_points(self, store: DuckDBStore) -> None:
        with store.connection() as con:
            con.execute(
                """
                COPY (
                  SELECT *, strftime(timestamp_utc_or_local, '%Y-%m-%d') AS date
                  FROM signal_points
                ) TO ? (FORMAT PARQUET, PARTITION_BY (press_id, date, system), OVERWRITE_OR_IGNORE TRUE)
                """,
                [str(self.series_dir)],
            )
