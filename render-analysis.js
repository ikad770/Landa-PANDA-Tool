import { PROGRESS_MESSAGES, USER_FACING_STAGES } from './config.js';
import { escapeAttribute, iconSvg, renderPandaEyes, renderStatusStrip } from './render.js';

export function renderAnalysisShell(root) {
  root.innerHTML = `<div class="analysis-shell">
    <header class="workspace-topbar"><div><p class="brand-eyebrow">PANDA Tool / Analysis Workspace</p><h1>Analysis Workspace</h1><p class="subtitle">Upload the required local files. Analysis starts only after both inputs are selected.</p></div><div class="workspace-actions"><button id="diagnosticsFromAnalysis" class="ghost hidden">Diagnostics</button><button id="logoutButton" class="ghost">${iconSvg('logOut')} Logout</button><span class="user-pill">Local</span></div></header>
    <section id="uploadWorkspace" class="workspace-grid">
      <article class="upload-console panel-glass"><p class="panel-kicker">INPUT REQUIREMENTS</p><h2>Prepare Service Radar analysis</h2><p class="panel-subtitle">Select one autocollect ZIP and one Rules Excel workbook. The V2 path parses, indexes, evaluates and finalizes one bounded result.</p><div class="upload-stack">
        ${uploadControl('autocollectInput','autocollectName','Autocollect ZIP','Root archive containing nested opc.zip.','.zip,application/zip','ZIP')}
        ${uploadControl('rulesInput','rulesName','Rules Excel','Workbook containing the PANDA Rules Template sheet.','.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','XLS')}
      </div><div class="validation-row" id="uploadValidation" aria-live="polite">Awaiting both required files.</div><div class="action-row"><label class="auto-open-toggle"><input id="autoOpenToggle" type="checkbox" checked> Open Results Workspace when complete</label><button id="startAnalysis" class="primary" disabled>Analyze</button><button id="resetUpload" class="ghost" type="button">Start New Analysis</button></div></article>
      <article class="scanner-console">${renderPandaEyes({ mode: 'idle' })}<div class="idle-scanner"><span></span><strong>Idle Scanner</strong><small>Awaiting log archive and rule model</small></div></article>
    </section>
    <section id="processingWorkspace" class="processing-shell hidden">
      <article class="processing-visual">${renderPandaEyes({ mode: 'processing' })}<div class="progress-core"><p>Analyzing Your Logs</p><strong id="progressPercent">0%</strong><span id="processingHeadline">Upload</span><small id="processingSubhead">Scanning systems, parameters and events…</small></div></article>
      <article class="progress-panel panel-glass"><div id="progressRing" class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--p:0%"><span></span></div><div id="processingSequence" class="stage-list"></div><details class="diagnostics-details"><summary>Diagnostics</summary><div class="processing-stats progress-grid"><div class="metric"><label>Current source</label><b id="currentSource">—</b></div><div class="metric"><label>Current file</label><b id="currentFile">—</b></div><div class="metric"><label>Files completed</label><b id="filesCount">0 / 0</b></div><div class="metric"><label>Matched values</label><b id="relevantValues">0</b></div><div class="metric"><label>Signals matched</label><b id="signalsMatched">0</b></div><div class="metric"><label>Elapsed</label><b id="elapsedTime">0s</b></div><div class="metric"><label>Estimated remaining</label><b id="remainingTime">—</b></div><div class="metric"><label>Warnings / Errors</label><b id="warningErrorCount">0 / 0</b></div></div></details><div class="action-row margin-top"><span class="tiny">Progress uses real V2 stage counters.</span><button id="cancelAnalysis" class="danger">Cancel</button></div></article>
    </section>
    <section id="failedWorkspace" class="panel ready-card hidden"><p class="brand-eyebrow">Analysis blocked</p><h2 id="failedReason">Analysis could not produce a valid result.</h2><p class="subtitle">The Service Radar remains disabled until the data path produces evaluated points. Open Diagnostics for the internal audit.</p><div class="action-row center"><button id="viewDiagnosticsFailed">Diagnostics</button><button id="resetFailed" class="ghost">New Analysis</button></div></section>
    <section id="readyWorkspace" class="panel ready-card hidden"><p id="readyEyebrow" class="brand-eyebrow">Analysis complete</p><h2 id="readyTitle">Compact AnalysisResult finalized</h2><p id="readySubtitle" class="subtitle">Service Radar is ready. Diagnostics remain separate from operational findings.</p><div class="ready-stats"><div class="metric"><label>Rules fully evaluated</label><b id="readyRules">0</b></div><div class="metric"><label>Signals matched</label><b id="readySignals">0</b></div><div class="metric"><label>Systems at risk</label><b id="readyRelevantValues">0</b></div><div class="metric"><label>Systems evaluated</label><b id="readyFullyEvaluated">0</b></div><div class="metric"><label>Validation issues</label><b id="readyNeedsValidation">0</b></div><div class="metric"><label>Configuration issues</label><b id="readySystems">0</b></div><div class="metric"><label>Operational findings</label><b id="readyDeviations">0</b></div><div class="metric"><label>Analysis time</label><b id="readyTime">0s</b></div><div class="metric"><label>Top blocker</label><b id="readyTopBlocker">None</b></div></div><div class="action-row center"><button id="openRadar" class="primary">Open Results Workspace</button><button id="viewDiagnosticsReady">Diagnostics</button><button id="resetReady" class="ghost">New Analysis</button></div></section>
  </div>${renderStatusStrip([['System Status','Operational'],['Data Source','Awaiting Upload'],['Analysis Engine','PANDA Core'],['Session Security','Local Prototype Session']])}`;
}

function uploadControl(id, nameId, title, help, accept, badge) {
  return `<label class="upload-card"><input id="${escapeAttribute(id)}" type="file" accept="${escapeAttribute(accept)}"><span class="upload-icon">${iconSvg('upload')}<b>${badge}</b></span><span><strong>${title}</strong><small>${help}</small><em id="${escapeAttribute(nameId)}">No file selected</em></span></label>`;
}

export function getVisualStage(progress = {}) {
  const stage = progress.stage || 'upload';
  return USER_FACING_STAGES.find(item => item.stages.includes(stage)) || USER_FACING_STAGES[0];
}

export function renderUserStages(activeStageKey = 'upload') {
  let activeSeen = false;
  const html = USER_FACING_STAGES.map(stage => {
    const active = stage.key === activeStageKey;
    const done = !activeSeen && !active;
    if (active) activeSeen = true;
    return `<div class="stage-step ${active ? 'active' : done ? 'done' : ''}"><span>${done ? '✓' : stage.weight}</span><strong>${stage.label}</strong><small>${done ? 'Complete' : active ? 'In progress' : 'Pending'}</small></div>`;
  }).join('');
  document.getElementById('processingSequence').innerHTML = html;
}

export function updateProgressPresentation(progress = {}) {
  const percent = Math.max(0, Math.min(100, Number(progress.overallPercent ?? progress.percent) || 0));
  const visual = getVisualStage(progress);
  const ring = document.getElementById('progressRing');
  ring?.style.setProperty('--p', `${percent}%`);
  ring?.setAttribute('aria-valuenow', String(percent));
  document.getElementById('progressPercent').textContent = `${percent}%`;
  document.getElementById('processingHeadline').textContent = progress.stageLabel || visual.label;
  document.getElementById('processingSubhead').textContent = progress.message || PROGRESS_MESSAGES[visual.key] || 'Scanning systems, parameters and events…';
  renderUserStages(visual.key);
}

export function updateUploadValidation(ready) {
  const el = document.getElementById('uploadValidation');
  if (el) el.textContent = ready ? 'Both required files are selected. Ready to analyze.' : 'Awaiting both required files.';
}
