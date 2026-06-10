from __future__ import annotations

from backend.app.storage.duckdb_store import DuckDBStore


def refresh_signal_catalog(store: DuckDBStore) -> None:
    store.rebuild_catalog()
