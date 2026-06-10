@echo off
REM Run from the repository root. In Anaconda Prompt, use the same commands after activating your environment.
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -e backend[test]
echo Setup complete. Run scripts\run_backend.bat or scripts\run_tests.bat.
