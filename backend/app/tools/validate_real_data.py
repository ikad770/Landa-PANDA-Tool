from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.app.core.config import get_settings
from backend.app.services.ingestion_service import IngestionService
from backend.app.services.state_service import relevant_state_system
from backend.app.storage.duckdb_store import DuckDBStore

SUPPORTED_TEXT = {".csv", ".txt", ".log"}
SUPPORTED_ARCHIVE = {".zip"}
SUPPORTED_SIGNAL_SOURCES = {"bss", "fec"}
MAX_JSON_BYTES = 1_000_000


def _lower_children(path: Path) -> dict[str, Path]:
    if not path.exists() or not path.is_dir():
        return {}
    return {child.name.lower(): child for child in sorted(path.iterdir(), key=lambda p: p.name.lower()) if child.is_dir()}


def _child(path: Path, name: str) -> Path | None:
    return _lower_children(path).get(name.lower())


def resolve_autocollect(root: Path) -> tuple[dict[str, Path | None], list[str]]:
    diagnostics: list[str] = []
    root = root.expanduser().resolve()
    opc = root if root.name.lower() == "opc" else _child(root, "OPC")
    if opc is None:
        diagnostics.append(f"Missing OPC directory under {root}")
        return {"bss": None, "fec": None, "machine_states": None}, diagnostics
    logs = _child(opc, "Logs")
    if logs is None:
        diagnostics.append(f"Missing Logs directory under {opc}")
        return {"bss": None, "fec": None, "machine_states": None}, diagnostics
    llci = _child(logs, "LLCINotifications")
    bss = _child(llci, "BSS") if llci else None
    fec = _child(logs, "FECNotifications")
    machine = _child(logs, "MachineStates")
    expected = {"bss": bss, "fec": fec, "machine_states": machine}
    for label, directory in expected.items():
        if directory is None:
            diagnostics.append(f"Missing expected {label} directory below {logs}")
    return expected, diagnostics


def _is_hidden_or_temp(path: Path) -> bool:
    return path.name.startswith(".") or path.name.startswith("~$")


def discover_files(source_type: str, directory: Path | None) -> dict[str, Any]:
    supported = SUPPORTED_TEXT | (SUPPORTED_ARCHIVE if source_type in {"bss", "fec"} else set())
    result: dict[str, Any] = {
        "source_type": source_type,
        "directory": str(directory.resolve()) if directory else None,
        "exists": bool(directory and directory.exists() and directory.is_dir()),
        "files": [],
        "zip_files": [],
        "csv_files": [],
        "text_files": [],
        "unsupported_files": [],
        "ignored_entries": [],
        "missing": False,
        "empty": False,
    }
    if directory is None or not directory.exists() or not directory.is_dir():
        result["missing"] = True
        return result
    for child in sorted(directory.iterdir(), key=lambda p: p.name.lower()):
        if _is_hidden_or_temp(child):
            result["ignored_entries"].append(str(child.resolve()))
            continue
        if child.is_dir():
            result["ignored_entries"].append(str(child.resolve()))
            continue
        suffix = child.suffix.lower()
        if suffix not in supported:
            result["unsupported_files"].append(str(child.resolve()))
            continue
        resolved = str(child.resolve())
        result["files"].append(resolved)
        if suffix == ".zip":
            result["zip_files"].append(resolved)
        elif suffix == ".csv":
            result["csv_files"].append(resolved)
        else:
            result["text_files"].append(resolved)
    result["empty"] = not result["files"]
    return result


def suspicious_signal_name(name: str) -> bool:
    text = name.strip()
    lower = text.lower()
    if lower.startswith("spitfire.server.modules."):
        return True
    if re.search(r"\.(dll|zip|csv)$", lower):
        return True
    if re.match(r"^[a-z]:[\\/]", lower) or lower.startswith("\\\\"):
        return True
    if "!/" in text or "!\\" in text:
        return True
    if re.search(r"(^|[\\/])[^\\/]+\.(csv|zip|dll)$", lower):
        return True
    if lower in {"bssnotifications", "fecnotifications", "machinestates", "bssnotifications.csv", "fecnotifications.csv"}:
        return True
    return False


def _dt(value: Any) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _duration(first: datetime | None, last: datetime | None) -> str | None:
    if not first or not last:
        return None
    return str(last - first)


def _serializable(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if hasattr(obj, "model_dump"):
        return {k: _serializable(v) for k, v in obj.model_dump().items()}
    if isinstance(obj, dict):
        return {k: _serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serializable(v) for v in obj]
    return obj


def build_report(store: DuckDBStore, run: Any, discovery: dict[str, Any], args: argparse.Namespace, root_diags: list[str], input_sources: set[str]) -> dict[str, Any]:
    systems = store.catalog_summary()
    all_signals = store.list_signals()
    coverage = store.time_coverage()
    diagnostics = store.diagnostics(run.ingestion_id)
    diag_counts: dict[str, int] = {}
    diag_groups: dict[str, dict[str, Any]] = {}
    for d in diagnostics:
        key = f"{d.get('code')}|{d.get('level')}|{d.get('source_file')}"
        diag_counts[key] = diag_counts.get(key, 0) + 1
        diag_groups.setdefault(key, {"code": d.get("code"), "severity": d.get("level"), "source_file": d.get("source_file"), "source_type": _source_from_file(str(d.get("source_file") or "")), "count": 0})["count"] += 1
    examples: dict[str, list[dict[str, str]]] = {}
    for sig in all_signals:
        bucket = examples.setdefault(sig["system"], [])
        if len(bucket) < args.max_example_signals:
            bucket.append({"system": sig["system"], "component": sig["component"], "signal": sig["signal_name"], "signal_id": sig["signal_id"]})
    series_validations = []
    for system in sorted({s["system"] for s in all_signals}):
        sig = next((s for s in all_signals if s["system"] == system), None)
        if not sig:
            continue
        agg, points = store.series(sig["signal_id"], max_points=args.max_series_points)
        machine = store.intervals("Machine", agg.get("first"), agg.get("last"))
        system_intervals = store.intervals(relevant_state_system(system), agg.get("first"), agg.get("last"))
        series_validations.append({
            "signal_id": sig["signal_id"], "system": system, "component": sig["component"], "signal": sig["signal_name"],
            "total_point_count": int(agg["total"]), "returned_point_count": len(points), "downsampled": int(agg["total"]) > len(points),
            "first_timestamp": agg.get("first"), "last_timestamp": agg.get("last"), "latest": agg.get("latest"),
            "minimum": agg.get("minimum"), "maximum": agg.get("maximum"), "average": agg.get("average"),
            "machine_state_intervals_returned": len(machine), "system_state_intervals_returned": len(system_intervals),
        })
    failed: list[str] = []
    warnings: list[str] = []
    if not input_sources:
        failed.append("no input source supplied")
    for source, info in discovery.items():
        if source in input_sources and info.get("missing"):
            failed.append(f"requested {source} directory does not exist")
    if run.status != "completed":
        failed.append("ingestion did not complete")
    files_discovered = sum(len(info["files"]) for info in discovery.values())
    if files_discovered and run.files_parsed == 0:
        failed.append("files were discovered but none were parsed")
    if input_sources & {"bss", "fec"} and run.numeric_points_written == 0:
        failed.append("numeric points written is zero for BSS/FEC input")
    if input_sources & {"bss", "fec"} and run.discovered_signals == 0:
        failed.append("discovered signal count is zero for BSS/FEC input")
    if "machine_states" in input_sources and store.count_intervals("machine") == 0:
        failed.append("MachineStates was provided but no Machine State intervals were produced")
    if all_signals and all(s["component"] == "Unclassified" or s["system"] == "FEC" and s["component"] == "Unclassified" for s in all_signals):
        failed.append("every discovered signal is mapped to Unclassified")
    systems_detected = {s["system"] for s in all_signals}
    if "bss" in input_sources and "BSS" not in systems_detected:
        failed.append("BSS was provided but system BSS was not detected")
    if "fec" in input_sources and not ({"IPU", "IRD", "CWS", "Ventilation", "FEC"} & systems_detected):
        failed.append("FEC was provided but no expected FEC-derived system was detected")
    bad_names = [s["signal_name"] for s in all_signals if suspicious_signal_name(str(s["signal_name"]))]
    if bad_names:
        failed.append(f"suspicious filename/DLL signal names detected: {bad_names[:5]}")
    for item in series_validations:
        if item["total_point_count"] == 0:
            failed.append(f"series validation returned zero total points for {item['signal_id']}")
        if item["returned_point_count"] > args.max_series_points:
            failed.append(f"series validation exceeded max points for {item['signal_id']}")
        if item["total_point_count"] and any(item[k] is None for k in ("latest", "minimum", "maximum", "average")):
            failed.append(f"series aggregates missing for {item['signal_id']}")
    if run.numeric_points_written != store.count_points():
        failed.append("ingestion numeric counter does not match stored points")
    if store.count_duplicate_signal_points() or store.count_duplicate_state_updates():
        failed.append("exact duplicate rows remain duplicated in storage")
    if any(info["unsupported_files"] for info in discovery.values()):
        warnings.append("unsupported files were ignored")
    if any(d.get("code") == "invalid_timestamp" for d in diagnostics):
        warnings.append("some invalid timestamps were reported")
    if any(s["system"] == "FEC" and s["component"] == "Unclassified" for s in all_signals):
        warnings.append("some FEC signals are unclassified")
    return {
        "metadata": {"generated_at": datetime.now().isoformat(), "press_id": args.press_id, "database": str(store.path), "json_size_limit_bytes": MAX_JSON_BYTES},
        "source_discovery": discovery, "root_diagnostics": root_diags,
        "ingestion": {**run.model_dump(), "rows_before_deduplication": run.rows_seen, "duplicates_removed": _duplicates_removed(diagnostics), "rows_stored": run.numeric_points_written + run.state_updates_written},
        "time_coverage": {**coverage, "total_duration": _duration(coverage.get("point_first") or coverage.get("state_first"), coverage.get("point_last") or coverage.get("state_last")), "machine_state_interval_count": store.count_intervals("machine"), "system_state_interval_count": store.count_intervals("system"), "state_systems_detected": store.state_systems()},
        "system_summaries": systems, "example_hierarchy": examples, "series_validations": series_validations,
        "diagnostic_counts": list(diag_groups.values())[: args.max_diagnostic_examples],
        "warnings": warnings, "failed_criteria": failed, "passed": not failed,
        "overlap_examples": store.point_source_overlap_summary(args.max_diagnostic_examples),
    }


def _duplicates_removed(diagnostics: list[dict[str, Any]]) -> dict[str, int]:
    total = {"signal_points": 0, "state_updates": 0}
    for d in diagnostics:
        if d.get("code") != "exact_duplicates_removed":
            continue
        try:
            details = json.loads(d.get("details") or "{}")
            total["signal_points"] += int(details.get("signal_points", 0))
            total["state_updates"] += int(details.get("state_updates", 0))
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return total


def _source_from_file(path: str) -> str | None:
    lower = path.lower()
    if "bss" in lower:
        return "bss"
    if "fec" in lower:
        return "fec"
    if "machinestates" in lower or "machine_states" in lower:
        return "machine_states"
    return None


def print_report(report: dict[str, Any], args: argparse.Namespace) -> None:
    print("SECTION 1 — INPUT DISCOVERY")
    print(f"Autocollect root: {args.autocollect_root or '-'}")
    for source, info in report["source_discovery"].items():
        print(f"{source}: {info['directory']} files={len(info['files'])} zip={len(info['zip_files'])} csv={len(info['csv_files'])} unsupported={len(info['unsupported_files'])} missing={info['missing']} empty={info['empty']}")
        for path in info["files"]:
            print(f"  FILE {path}")
        for path in info["unsupported_files"]:
            print(f"  WARNING unsupported ignored {path}")
    for diag in report["root_diagnostics"]:
        print(f"WARNING {diag}")
    print("\nSECTION 2 — INGESTION")
    for key, value in report["ingestion"].items():
        print(f"{key}: {value}")
    print("\nSECTION 3 — TIME COVERAGE")
    for key, value in report["time_coverage"].items():
        print(f"{key}: {value}")
    print("\nSECTION 4 — SYSTEM CATALOG")
    for system in report["system_summaries"]:
        print(f"{system['system']}: components={system['component_count']} signals={system['signal_count']} points={system['point_count']} first={system['first_timestamp']} last={system['last_timestamp']} unclassified={system['unclassified_count']}")
    print("\nSECTION 5 — EXAMPLE HIERARCHY")
    for system, examples in report["example_hierarchy"].items():
        for ex in examples:
            print(f"{system} → {ex['component']} → {ex['signal']}")
    print("\nSECTION 6 — SERIES VALIDATION")
    for item in report["series_validations"]:
        print(f"{item['signal_id']} {item['system']} → {item['component']} → {item['signal']} total={item['total_point_count']} returned={item['returned_point_count']} downsampled={item['downsampled']} first={item['first_timestamp']} last={item['last_timestamp']} latest={item['latest']} min={item['minimum']} max={item['maximum']} avg={item['average']} machine_states={item['machine_state_intervals_returned']} system_states={item['system_state_intervals_returned']}")
    print("\nSECTION 7 — DIAGNOSTICS")
    for item in report["diagnostic_counts"]:
        print(f"{item['severity']} {item['code']} source_type={item['source_type']} source_file={item['source_file']} count={item['count']}")
    print("\nSECTION 8 — FINAL RESULT")
    for warning in report["warnings"]:
        print(f"WARNING: {warning}")
    if report["passed"]:
        print("PANDA REAL-DATA VALIDATION: PASS")
    else:
        for failure in report["failed_criteria"]:
            print(f"FAIL: {failure}")
        print("PANDA REAL-DATA VALIDATION: FAIL")


def write_json(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_serializable(report), indent=2, sort_keys=True)
    if len(text.encode("utf-8")) > MAX_JSON_BYTES:
        raise ValueError(f"JSON report exceeds maximum size of {MAX_JSON_BYTES} bytes")
    path.write_text(text, encoding="utf-8")


def _safe_reset(settings: Any, store: DuckDBStore) -> None:
    data_dir = settings.data_dir.resolve()
    db_path = store.path.resolve()
    if data_dir == Path(data_dir.anchor) or data_dir == Path.cwd().resolve():
        raise ValueError(f"Refusing unsafe runtime reset for data directory {data_dir}")
    if data_dir not in db_path.parents:
        raise ValueError(f"Refusing reset because database {db_path} is outside configured data directory {data_dir}")
    print(f"INFO: Resetting PANDA runtime data in configured data directory only: {data_dir}")
    store.reset_runtime_data()
    processed = settings.processed_dir.resolve()
    if data_dir in processed.parents or processed == data_dir:
        for pattern in ("*.parquet", "*.duckdb.wal"):
            for file in processed.glob(pattern):
                if file.is_file():
                    file.unlink()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate PANDA V4 ingestion against real Autocollect log layout")
    parser.add_argument("--press-id", required=True)
    parser.add_argument("--autocollect-root")
    parser.add_argument("--bss-dir")
    parser.add_argument("--fec-dir")
    parser.add_argument("--machine-states-dir")
    parser.add_argument("--json-output")
    parser.add_argument("--reset-runtime-data", action="store_true")
    parser.add_argument("--max-example-signals", type=int, default=10)
    parser.add_argument("--max-diagnostic-examples", type=int, default=20)
    parser.add_argument("--max-series-points", type=int, default=500)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    store = DuckDBStore(settings.duckdb_path)
    if args.reset_runtime_data:
        _safe_reset(settings, store)
    root_diags: list[str] = []
    resolved = {"bss": None, "fec": None, "machine_states": None}
    explicit = {"bss": args.bss_dir, "fec": args.fec_dir, "machine_states": args.machine_states_dir}
    if args.autocollect_root:
        resolved, root_diags = resolve_autocollect(Path(args.autocollect_root))
    for source, value in explicit.items():
        if value:
            resolved[source] = Path(value).expanduser().resolve()
    if args.autocollect_root:
        input_sources = {"bss", "fec", "machine_states"}
    else:
        input_sources = {source for source, directory in resolved.items() if directory is not None}
    discovery = {source: discover_files(source, directory) for source, directory in resolved.items()}
    paths = [path for source in ("bss", "fec", "machine_states") for path in discovery[source]["files"]]
    if not input_sources:
        dummy = type("Run", (), {"ingestion_id": "not-started", "status": "not-started", "model_dump": lambda self: {"ingestion_id": "not-started", "status": "not-started"}})()
        report = {"source_discovery": discovery, "root_diagnostics": root_diags, "ingestion": dummy.model_dump(), "time_coverage": {}, "system_summaries": [], "example_hierarchy": {}, "series_validations": [], "diagnostic_counts": [], "warnings": [], "failed_criteria": ["no input source supplied"], "passed": False}
        print_report(report, args)
        return 2
    missing = [s for s in input_sources if discovery[s]["missing"]]
    if missing:
        dummy = type("Run", (), {"ingestion_id": "not-started", "status": "not-started", "model_dump": lambda self: {"ingestion_id": "not-started", "status": "not-started"}})()
        report = {"source_discovery": discovery, "root_diagnostics": root_diags, "ingestion": dummy.model_dump(), "time_coverage": {}, "system_summaries": [], "example_hierarchy": {}, "series_validations": [], "diagnostic_counts": [], "warnings": [], "failed_criteria": [f"requested {s} directory does not exist" for s in missing], "passed": False}
        print_report(report, args)
        return 2
    run = IngestionService(store, settings).ingest_paths(paths, press_id=args.press_id)
    report = build_report(store, run, discovery, args, root_diags, input_sources)
    print_report(report, args)
    if args.json_output:
        write_json(Path(args.json_output), report)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
