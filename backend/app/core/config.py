from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(os.getenv("PANDA_DATA_DIR", "data"))
    duckdb_path: Path = Path(os.getenv("PANDA_DUCKDB_PATH", "data/processed/panda.duckdb"))
    max_upload_mb: int = _int_env("PANDA_MAX_UPLOAD_MB", 512)
    max_archive_depth: int = _int_env("PANDA_MAX_ARCHIVE_DEPTH", 3)
    max_archive_files: int = _int_env("PANDA_MAX_ARCHIVE_FILES", 5000)
    max_uncompressed_mb: int = _int_env("PANDA_MAX_UNCOMPRESSED_MB", 2048)
    batch_size: int = _int_env("PANDA_BATCH_SIZE", 10000)
    default_max_points: int = _int_env("PANDA_DEFAULT_MAX_POINTS", 2000)

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"


def get_settings() -> Settings:
    return Settings()
