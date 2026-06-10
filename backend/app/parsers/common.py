from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import datetime
from typing import Iterable

CONTROL_RE = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]+")


def clean_text(value: object) -> str:
    return CONTROL_RE.sub("", str(value or "").replace("\ufeff", "")).strip()


def parse_timestamp(value: object) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    formats = ("%d/%m/%Y %H:%M:%S:%f", "%d/%m/%Y %H:%M:%S.%f", "%d/%m/%Y %H:%M:%S")
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def parse_number(value: object) -> float | None:
    text = clean_text(value).replace(",", "")
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def read_csv_dicts(text: str) -> tuple[list[str], Iterable[tuple[int, dict[str, str]]]]:
    cleaned = text.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    sample = cleaned[:4096]
    delimiter = ","
    if sample.count("\t") > sample.count(","):
        delimiter = "\t"
    stream = io.StringIO(cleaned)
    reader = csv.DictReader(stream, delimiter=delimiter)
    headers = [clean_text(h) for h in (reader.fieldnames or [])]

    def rows() -> Iterable[tuple[int, dict[str, str]]]:
        for index, row in enumerate(reader, start=2):
            yield index, {clean_text(k): clean_text(v) for k, v in row.items() if k is not None}

    return headers, rows()


def exact_headers(headers: list[str], expected: list[str]) -> bool:
    return [clean_text(h) for h in headers] == expected


def stable_signal_id(press_id: str, source_type: str, system: str, component: str, device: str, signal_name: str) -> str:
    raw = "|".join([press_id, source_type, system, component, device, signal_name]).lower()
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def infer_unit(signal_name: str) -> str | None:
    name = signal_name.lower()
    if name.endswith("c") or "temp" in name:
        return "C"
    if "pressure" in name:
        return None
    if name.endswith("mm"):
        return "mm"
    if "pwm" in name:
        return "%"
    return None
