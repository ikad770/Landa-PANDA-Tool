@echo off
REM Run from the repository root. Activate .venv or an Anaconda environment first if needed.
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
