from __future__ import annotations

from pathlib import Path
import zipfile

import pytest
from backend.app.core.config import Settings
from backend.app.services.ingestion_service import IngestionService
from backend.app.storage.duckdb_store import DuckDBStore

BSS_HEADER = "Timestamp,Action,MessageType,LLCIKey,MachineType,Component,SubComponent,ParameterType,Value,IsAlert\n"
FEC_HEADER = "Timestamp,Type,CableId,PSSID,SetPoint,Enabled,HasErrors,HasWarnings,PSCState,Status,State\n"
MACHINE_HEADER = "Time,Machine,BSS,IPS,PSS,Dryer,IPU,Ventilation,CWS,IRD,DFES,DPS,QCS,ICS,ECS,MSPS,ITS\n"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", duckdb_path=tmp_path / "data" / "processed" / "test.duckdb", batch_size=5000, default_max_points=50, max_archive_depth=3, max_archive_files=100, max_uncompressed_mb=256)


@pytest.fixture
def store(settings: Settings):
    db = DuckDBStore(settings.duckdb_path)
    yield db
    db.close()


@pytest.fixture
def service(store: DuckDBStore, settings: Settings) -> IngestionService:
    return IngestionService(store, settings)


def write_text(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def make_zip(path: Path, files: dict[str, str | bytes]) -> Path:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return path
