# Landa PANDA Tool — Stable Git Base

This is a clean, stable frontend base for the Landa PANDA Tool.

## What it does now

- Runs as a React/Vite app.
- Uploads ZIP files or full folders.
- Scans recursively for nested ZIP files.
- Detects `opc.zip -> logs/` structure.
- Supports multiple machines in one upload.
- Builds a machine inventory with detected systems.
- Displays a basic rule catalog from the converted parameter file.
- Provides a professional, stable Service Radar UI base.

## What it does not do yet

- It does not parse exact signal values from each log file yet.
- It does not evaluate the full Excel rules file yet.
- It does not include final subsystem visual assets yet.

## Run locally

```bash
npm install --no-audit --no-fund
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Recommended upload formats

You can upload:

1. A root folder with multiple machine folders:

```text
Root folder
├── S100100025
│   └── autocollect.zip
│       └── opc.zip
│           └── logs/
├── S100100026
│   └── ...
└── D110100023
    └── ...
```

2. A single machine ZIP.
3. An `opc.zip` directly.
4. A folder that already contains `logs/`.

## Important

Do not commit `node_modules/` or `dist/`.
