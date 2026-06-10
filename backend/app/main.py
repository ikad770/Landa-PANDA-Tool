from __future__ import annotations

try:
    from fastapi import FastAPI
except ModuleNotFoundError:
    class FastAPI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.routes = []
        def include_router(self, router):
            self.routes.append(router)
        def openapi(self):
            return {"openapi": "3.1.0", "info": {"title": self.kwargs.get("title"), "version": self.kwargs.get("version")}}

from backend.app.api.v1 import router
from backend.app.core.logging import configure_logging

configure_logging()

app = FastAPI(
    title="PANDA V4 Data Foundation",
    version="0.1.0",
    description="Clean backend foundation for PANDA log ingestion, signal cataloging, time-series querying, state timelines, and diagnostics. Rules, alerts, Service Radar, and Drill-Down UI are intentionally out of scope for this milestone.",
)
app.include_router(router)
