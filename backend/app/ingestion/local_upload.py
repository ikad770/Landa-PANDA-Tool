from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterable

try:
    from fastapi import UploadFile
except ModuleNotFoundError:
    class UploadFile: pass


def normalize_local_paths(paths: Iterable[str | Path]) -> list[str]:
    return [str(Path(path)) for path in paths]


async def save_uploads(files: list[UploadFile], raw_dir: Path, max_upload_bytes: int) -> list[str]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for upload in files:
        suffix = Path(upload.filename or "upload").suffix
        with NamedTemporaryFile(delete=False, suffix=suffix, dir=raw_dir) as handle:
            total = 0
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > max_upload_bytes:
                    raise ValueError(f"Upload {upload.filename} exceeds configured size limit")
                handle.write(chunk)
            saved.append(handle.name)
    return saved
