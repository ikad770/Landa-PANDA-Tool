import { APP_STAGES } from './config.js';
import { chooseInitialSystem, renderDiagnostics, renderDrilldown, renderServiceRadar, validateAnalysisResult } from './render.js';

const $ = id => document.getElementById(id);
const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;

const app = {
  autocollectFile: null,
  rulesFile: null,
  worker: null,
  result: null,
  progress: null,
  selectedSystem: null,
  selectedEventId: null,
  selectedRuleId: null,
  systemFilter: 'issues',
  lastView: 'analysis',
  workerUrl: null
};

function show(view) {
  ['analysisView', 'radarView', 'drilldownView', 'diagnosticsView'].forEach(id => $(id).classList.toggle('hidden', id !== view));
  app.lastView = view === 'diagnosticsView' ? app.lastView : view.replace('View', '');
}

function renderAnalysisWorkspace() {
  $('startAnalysis').disabled = !(app.autocollectFile && app.rulesFile && !app.worker);
  $('diagnosticsFromAnalysis').classList.toggle('hidden', !app.result);
}

function setWorkspaceMode(mode) {
  $('uploadWorkspace').classList.toggle('hidden', mode !== 'upload');
  $('processingWorkspace').classList.toggle('hidden', mode !== 'processing');
  $('readyWorkspace').classList.toggle('hidden', mode !== 'ready');
}

function startAnalysis() {
  if (!app.autocollectFile || !app.rulesFile) return;
  app.result = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; app.selectedRuleId = null;
  setWorkspaceMode('processing');
  renderSequence('rules_loading');
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  app.worker = worker;
  worker.onmessage = event => handleWorkerMessage(event.data);
  worker.onerror = event => failAnalysis(event.message || 'Worker failed');
  worker.postMessage({ type: 'start', autocollectFile: app.autocollectFile, rulesFile: app.rulesFile });
}

function handleWorkerMessage(message) {
  if (message.type === 'progress') {
    app.progress = message.progress;
    renderProgress(message.progress);
  } else if (message.type === 'complete') {
    finishWorker();
    validateAnalysisResult(message.result);
    app.result = message.result;
    app.selectedSystem = chooseInitialSystem(app.result);
    app.selectedEventId = app.result.deviationEvents[0]?.id || null;
    renderReady();
    setWorkspaceMode('ready');
    renderDiagnostics(app.result);
    if ($('autoOpenToggle').checked) showServiceRadar();
  } else if (message.type === 'error') {
    finishWorker();
    app.result = message.diagnosticsSummary ? { diagnosticsSummary: message.diagnosticsSummary } : app.result;
    failAnalysis(message.message);
  }
}

function finishWorker() {
  if (app.worker) app.worker.terminate();
  app.worker = null;
  renderAnalysisWorkspace();
}

function cancelAnalysis() {
  if (app.worker) app.worker.postMessage({ type: 'cancel' });
  finishWorker();
  setWorkspaceMode('upload');
}

function failAnalysis(message) {
  setWorkspaceMode('upload');
  alert(`Analysis failed: ${message}`);
  renderAnalysisWorkspace();
}

function renderProgress(progress) {
  $('progressRing').style.setProperty('--p', `${progress.percent}%`);
  $('progressPercent').textContent = `${progress.percent}%`;
  $('processingHeadline').textContent = APP_STAGES.find(([key]) => key === progress.stage)?.[1] || 'Processing';
  $('processingSubhead').textContent = progress.message || 'Processing';
  $('currentSource').textContent = progress.currentSource || '—';
  $('currentFile').textContent = progress.currentFile || '—';
  $('filesCount').textContent = `${progress.filesCompleted || 0} / ${progress.filesTotal || 0}`;
  $('relevantValues').textContent = progress.relevantValuesFound || 0;
  $('signalsMatched').textContent = progress.signalsMatched || 0;
  $('elapsedTime').textContent = fmtDuration(progress.elapsedMs || 0);
  $('remainingTime').textContent = progress.remainingMs === null ? '—' : fmtDuration(progress.remainingMs);
  $('warningErrorCount').textContent = `${progress.warnings || 0} / ${progress.errors || 0}`;
  renderSequence(progress.stage);
}

function renderSequence(activeStage) {
  let activeSeen = false;
  $('processingSequence').innerHTML = APP_STAGES.map(([key, label, weight]) => {
    const isActive = key === activeStage;
    const done = !activeSeen && !isActive;
    if (isActive) activeSeen = true;
    return `<div class="sequence-step ${isActive ? 'active' : done ? 'done' : ''}"><span class="step-dot">${done ? '✓' : weight}</span><span>${label}</span><small>${weight}%</small></div>`;
  }).join('');
}

function renderReady() {
  const meta = app.result.metadata;
  $('readyRules').textContent = `${meta.rulesEvaluated} / ${meta.rulesValid}`;
  $('readySignals').textContent = `${meta.relevantSignalsFound} / ${meta.relevantSignalsRequired}`;
  $('readySystems').textContent = meta.systemsEvaluated;
  $('readyDeviations').textContent = meta.deviationsFound;
  $('readyTime').textContent = fmtDuration(meta.analysisTimeMs);
}

function showServiceRadar() {
  if (!app.result?.metadata) return;
  renderServiceRadar(app, { selectEvent, openDrilldown });
  show('radarView');
}
function showAnalysisWorkspace() { show('analysisView'); }
function openDiagnostics() { renderDiagnostics(app.result); show('diagnosticsView'); }
function showDrilldown() { renderDrilldown(app, { selectRule }); show('drilldownView'); }
function openDrilldown(system) { app.selectedSystem = system; showDrilldown(); }
function selectEvent(id) { app.selectedEventId = id; renderServiceRadar(app, { selectEvent, openDrilldown }); }
function selectRule(id) { app.selectedRuleId = id; renderDrilldown(app, { selectRule }); }
function resetAnalysis() { cancelAnalysis(); app.autocollectFile = null; app.rulesFile = null; app.result = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; $('autocollectInput').value = ''; $('rulesInput').value = ''; $('autocollectName').textContent = 'No file selected'; $('rulesName').textContent = 'No file selected'; setWorkspaceMode('upload'); showAnalysisWorkspace(); renderAnalysisWorkspace(); }

$('autocollectInput').addEventListener('change', e => { app.autocollectFile = e.target.files[0] || null; $('autocollectName').textContent = app.autocollectFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('rulesInput').addEventListener('change', e => { app.rulesFile = e.target.files[0] || null; $('rulesName').textContent = app.rulesFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('startAnalysis').onclick = startAnalysis;
$('cancelAnalysis').onclick = cancelAnalysis;
$('openRadar').onclick = showServiceRadar;
$('viewDiagnosticsReady').onclick = openDiagnostics;
$('diagnosticsFromAnalysis').onclick = openDiagnostics;
$('diagnosticsFromRadar').onclick = openDiagnostics;
$('diagnosticsFromDrill').onclick = openDiagnostics;
$('backToAnalysis').onclick = showAnalysisWorkspace;
$('backToRadar').onclick = showServiceRadar;
$('resetReady').onclick = resetAnalysis;
$('resetFromRadar').onclick = resetAnalysis;
$('resetFromDiagnostics').onclick = resetAnalysis;
$('showIssues').onclick = () => { app.systemFilter = 'issues'; $('showIssues').setAttribute('aria-pressed', 'true'); $('showAllSystems').setAttribute('aria-pressed', 'false'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('showAllSystems').onclick = () => { app.systemFilter = 'all'; $('showIssues').setAttribute('aria-pressed', 'false'); $('showAllSystems').setAttribute('aria-pressed', 'true'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('closeDiagnostics').onclick = () => app.lastView === 'radar' ? showServiceRadar() : app.lastView === 'drilldown' ? showDrilldown() : showAnalysisWorkspace();

renderAnalysisWorkspace();
