from __future__ import annotations

from backend.app.storage.duckdb_store import DuckDBStore


def rebuild_and_align_states(store: DuckDBStore) -> None:
    store.rebuild_state_intervals()
    store.align_points_with_states()


def relevant_state_system(signal_system: str) -> str:
    if signal_system == "BSS":
        return "BSS"
    if signal_system == "IPU":
        return "IPU"
    if signal_system in {"IRD", "Dryer"}:
        return "IRD" if signal_system == "IRD" else "Dryer"
    if signal_system == "CWS":
        return "CWS"
    if signal_system == "Ventilation":
        return "Ventilation"
    return signal_system
