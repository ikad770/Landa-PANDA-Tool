# Landa PANDA Tool

Stable GitHub-first base for the Landa PANDA Tool.

## What this project is

PANDA is a service-team tool for analyzing machine log packages and preparing state-aware alerts based on machine systems, parameters, and rules.

Current foundation includes:

- React + Vite frontend
- Upload panel for ZIP/files/folders
- Recursive ZIP inventory scanner via JSZip
- Machine detection from folder/archive paths
- System detection from log paths
- Initial rule catalog model
- Basic state-aware rule-evaluator services
- Professional dark UI foundation

## Important: how to open the app

Do **not** open `index.html` directly from GitHub file preview. A Vite React app must be built and served.

Use one of these options:

### Option A — GitHub Pages, no local CMD required

1. Upload this full repository to GitHub.
2. Go to repository **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. Push to `main`.
5. Open the deployed URL shown in **Actions** or **Settings → Pages**.

This repository includes `.github/workflows/deploy-github-pages.yml`, which builds the app and deploys `dist/` automatically.

### Option B — Local development

```bash
npm install --no-audit --no-fund
npm run dev
```

Then open:

```text
http://localhost:5173/
```

## Why GitHub file preview does not work

GitHub repository file preview only displays source files. It does not run Vite, does not install packages, and does not build React.

If you open the source `index.html` directly from GitHub, the browser may request `main.jsx` incorrectly or fail to load modules. Use GitHub Pages or local Vite instead.

## Project structure

```text
index.html
package.json
vite.config.js
.github/workflows/deploy-github-pages.yml
src/
  main.jsx
  App.jsx
  styles.css
  components/
  data/
  services/
  utils/
```

## Next development steps

1. Import PANDA rules from Excel.
2. Improve scanner progress and large ZIP handling.
3. Parse StateMachine and relevant notification logs.
4. Connect rules to real readings.
5. Add alert lifecycle and service workflow.
