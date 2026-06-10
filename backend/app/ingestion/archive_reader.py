from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterator
from zipfile import BadZipFile, ZipFile
import io

from backend.app.models.domain import Diagnostic

ALLOWED_EXTENSIONS = {".csv", ".txt", ".log", ".zip"}


@dataclass(frozen=True)
class ArchiveLimits:
    max_depth: int = 3
    max_files: int = 5000
    max_uncompressed_bytes: int = 2048 * 1024 * 1024
    allowed_extensions: frozenset[str] = frozenset(ALLOWED_EXTENSIONS)


@dataclass(frozen=True)
class TextEntry:
    name: str
    text: str
    depth: int


def _safe_name(name: str) -> bool:
    path = PurePosixPath(name.replace("\\", "/"))
    return not path.is_absolute() and ".." not in path.parts


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replace"


def iter_entries(paths: list[str], limits: ArchiveLimits, ingestion_id: str | None = None) -> Iterator[TextEntry | Diagnostic]:
    queue: deque[tuple[str, bytes, int]] = deque()
    for path in paths:
        with open(path, "rb") as handle:
            queue.append((path, handle.read(), 0))
    seen_files = 0
    seen_names: set[str] = set()
    uncompressed_total = 0
    while queue:
        name, data, depth = queue.popleft()
        suffix = PurePosixPath(name).suffix.lower()
        if suffix not in limits.allowed_extensions:
            yield Diagnostic(ingestion_id=ingestion_id, level="info", code="unsupported_file", message="Unsupported file extension skipped", source_file=name)
            continue
        seen_files += 1
        if seen_files > limits.max_files:
            yield Diagnostic(ingestion_id=ingestion_id, level="error", code="archive_file_limit", message="Maximum archive file count exceeded", source_file=name)
            return
        if suffix == ".zip":
            if depth >= limits.max_depth:
                yield Diagnostic(ingestion_id=ingestion_id, level="error", code="archive_depth_limit", message="Maximum nested archive depth exceeded", source_file=name)
                continue
            try:
                with ZipFile(io.BytesIO(data)) as zf:
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        nested_name = f"{name}!/{info.filename}"
                        if not _safe_name(info.filename):
                            yield Diagnostic(ingestion_id=ingestion_id, level="error", code="path_traversal", message="Archive entry path is unsafe", source_file=nested_name)
                            continue
                        uncompressed_total += int(info.file_size)
                        if uncompressed_total > limits.max_uncompressed_bytes:
                            yield Diagnostic(ingestion_id=ingestion_id, level="error", code="archive_size_limit", message="Maximum uncompressed archive size exceeded", source_file=nested_name)
                            return
                        if nested_name in seen_names:
                            yield Diagnostic(ingestion_id=ingestion_id, level="warning", code="duplicate_filename", message="Duplicate archive entry name encountered", source_file=nested_name)
                        seen_names.add(nested_name)
                        queue.append((nested_name, zf.read(info), depth + 1))
            except BadZipFile:
                yield Diagnostic(ingestion_id=ingestion_id, level="error", code="invalid_zip", message="ZIP file could not be opened", source_file=name)
            continue
        text, encoding = _decode(data)
        yield Diagnostic(ingestion_id=ingestion_id, level="info", code="encoding_detected", message=f"Decoded text file with {encoding}", source_file=name)
        yield TextEntry(name=name, text=text, depth=depth)
