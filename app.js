import { APP_STAGES, AUTH_CONFIG } from './config.js';
import { authenticateLocalPrototype, clearSession, createLocalSession, readStoredSession, storeSession, validateLoginFields } from './auth.js';
import { renderLoginShell, renderLoginValidation, setAccessGranted, setLoginAuthenticating } from './render-login.js';
import { renderAnalysisShell, renderUserStages, updateProgressPresentation, updateUploadValidation } from './render-analysis.js';
import { getServiceDecision } from './render.js';
import { chooseInitialSystem, renderDiagnostics, renderServiceRadar, validateAnalysisResult } from './render-radar.js';
import { renderDrilldown } from './render-drilldown.js';

const $ = id => document.getElementById(id);
const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;

const app = {
  autocollectFile: null,
  rulesFile: null,
  worker: null,
  analysisResult: null,
  progress: null,
  selectedSystem: null,
  selectedEventId: null,
  selectedRuleId: null,
  systemFilter: 'issues',
  lastView: 'analysis',
  workerUrl: null,
  session: null,
  authLoading: false
};

renderLoginShell($('loginView'));
renderAnalysisShell($('analysisView'));
app.session = readStoredSession();

const loginState = { username: '', password: '', touched: { username: false, password: false }, submitted: false, errors: {}, message: '' };

function show(view) {
  ['loginView', 'analysisView', 'radarView', 'drilldownView', 'diagnosticsView'].forEach(id => $(id).classList.toggle('hidden', id !== view));
  app.lastView = view === 'diagnosticsView' ? app.lastView : view.replace('View', '');
}


function setLoginLoading(loading) {
  app.authLoading = loading;
  setLoginAuthenticating(loading);
}

function validateLoginState() {
  const validation = validateLoginFields({ username: loginState.username, password: loginState.password });
  loginState.errors = validation.errors;
  return validation;
}

function syncLoginValidation(message = loginState.message) {
  validateLoginState();
  renderLoginValidation({ errors: loginState.errors, message, touched: loginState.touched, submitted: loginState.submitted });
}

function submitLogin(event) {
  event.preventDefault();
  if (app.authLoading) return;
  loginState.submitted = true;
  loginState.message = '';
  const result = authenticateLocalPrototype({ username: loginState.username, password: loginState.password });
  loginState.errors = result.errors || {};
  if (!result.valid) { renderLoginValidation({ errors: loginState.errors, touched: loginState.touched, submitted: true }); return; }
  if (!result.ok) { renderLoginValidation({ errors: {}, message: 'Invalid username or password.', touched: loginState.touched, submitted: true }); return; }
  renderLoginValidation({ errors: {}, message: '', touched: loginState.touched, submitted: true });
  setLoginLoading(true);
  window.setTimeout(() => {
    app.session = createLocalSession(result.username);
    storeSession(app.session);
    const userPill = document.querySelector('.user-pill');
    if (userPill) userPill.textContent = app.session.username;
    setAccessGranted(true);
    window.setTimeout(() => {
      setLoginLoading(false);
      setAccessGranted(false);
      showAnalysisWorkspace();
    }, 700);
  }, 180);
}

function forgotPassword() {
  document.getElementById('forgotModal')?.classList.remove('hidden');
}

function logout() {
  clearSession();
  app.session = null;
  resetAnalysis();
  show('loginView');
}

function renderAnalysisWorkspace() {
  const ready = !!(app.autocollectFile && app.rulesFile && !app.worker);
  $('startAnalysis').disabled = !ready;
  updateUploadValidation(!!(app.autocollectFile && app.rulesFile));
  $('diagnosticsFromAnalysis').classList.toggle('hidden', !app.analysisResult);
}

function setWorkspaceMode(mode) {
  $('uploadWorkspace').classList.toggle('hidden', mode !== 'upload');
  $('processingWorkspace').classList.toggle('hidden', mode !== 'processing');
  $('readyWorkspace').classList.toggle('hidden', mode !== 'ready');
  $('failedWorkspace').classList.toggle('hidden', mode !== 'failed');
}

function startAnalysis() {
  if (!app.autocollectFile || !app.rulesFile) return;
  app.analysisResult = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; app.selectedRuleId = null;
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
    const result = message.analysisResult || message.result;
    const validation = validateAnalysisResult(result);
    if (!validation.valid) {
      failAnalysis(validation.reason);
      return;
    }
    app.analysisResult = result;
    app.analysisResult.validation = validation;
    app.selectedSystem = chooseInitialSystem(app.analysisResult);
    app.selectedEventId = app.analysisResult.deviationEvents[0]?.id || null;
    renderReady();
    setWorkspaceMode('ready');
    renderDiagnostics(app.analysisResult);
    if ($('autoOpenToggle').checked) showServiceRadar();
  } else if (message.type === 'error') {
    finishWorker();
    app.analysisResult = message.diagnosticsSummary ? { diagnosticsSummary: message.diagnosticsSummary } : app.analysisResult;
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
  $('failedReason').textContent = message || 'Analysis could not produce a valid result.';
  setWorkspaceMode('failed');
  renderAnalysisWorkspace();
}

function renderProgress(progress) {
  updateProgressPresentation(progress);
  $('currentSource').textContent = progress.currentSource || '—';
  const currentFilePath = progress.currentFile || '';
  $('currentFile').textContent = currentFilePath ? currentFilePath.split(/[\\/!]+/).filter(Boolean).at(-1) : '—';
  $('currentFile').title = currentFilePath;
  $('filesCount').textContent = `${progress.filesCompleted || 0} / ${progress.filesTotal || 0}`;
  $('relevantValues').textContent = progress.relevantValuesFound || 0;
  $('signalsMatched').textContent = progress.signalsMatched || 0;
  $('elapsedTime').textContent = fmtDuration(progress.elapsedMs || 0);
  $('remainingTime').textContent = progress.remainingMs === null ? '—' : fmtDuration(progress.remainingMs);
  $('warningErrorCount').textContent = `${progress.warnings || 0} / ${progress.errors || 0}`;
  renderSequence(progress.stage);
}

function renderSequence(activeStage) {
  updateProgressPresentation({ stage: activeStage, percent: app.progress?.percent || 0 });
}

function renderReady() {
  const meta = app.analysisResult.metadata;
  const validation = app.analysisResult.validation || { status: 'completed' };
  const decision = getServiceDecision(app.analysisResult);
  const topBlocker = app.analysisResult.diagnosticsSummary?.evaluationBlockers?.topBlocker;
  $('readyEyebrow').textContent = validation.status === 'completed_with_warnings' ? 'Ready with service actions' : 'Analysis complete';
  $('readyTitle').textContent = decision.machineStatusLabel || 'Service Radar ready';
  $('readySubtitle').textContent = decision.machineSummary || 'Service Radar is ready. Diagnostics remain separate from operational findings.';
  $('readyRules').textContent = `${decision.kpis.evaluationReadiness.evaluated || 0} / ${decision.kpis.evaluationReadiness.total || 0}`;
  $('readySignals').textContent = `${decision.kpis.signalCoverage.found} / ${decision.kpis.signalCoverage.required}`;
  $('readyRelevantValues').textContent = `${decision.systemsAtRiskCount || 0}`;
  $('readyFullyEvaluated').textContent = `${decision.fullyEvaluatedSystems.length || 0}`;
  $('readyNeedsValidation').textContent = `${decision.validationProblems.length || 0}`;
  $('readySystems').textContent = `${decision.configurationProblems.length || 0}`;
  $('readyDeviations').textContent = `${decision.operationalFindings.length || 0}`;
  $('readyTime').textContent = fmtDuration(meta.analysisTimeMs);
  $('readyTopBlocker').textContent = topBlocker?.label || 'None';
}

function showServiceRadar() {
  if (!app.analysisResult?.metadata) return;
  renderServiceRadar(app, { selectEvent, openDrilldown });
  show('radarView');
}
function showAnalysisWorkspace() { show('analysisView'); }
function openDiagnostics() { renderDiagnostics(app.analysisResult); show('diagnosticsView'); }
function showDrilldown() { renderDrilldown(app, { selectRule }); show('drilldownView'); }
function openDrilldown(system) { app.selectedSystem = system; showDrilldown(); }
function selectEvent(id) { app.selectedEventId = id; renderServiceRadar(app, { selectEvent, openDrilldown }); }
function selectRule(id) { app.selectedRuleId = id; renderDrilldown(app, { selectRule }); }
function resetAnalysis() { cancelAnalysis(); app.autocollectFile = null; app.rulesFile = null; app.analysisResult = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; app.selectedRuleId = null; $('autocollectInput').value = ''; $('rulesInput').value = ''; $('autocollectName').textContent = 'No file selected'; $('rulesName').textContent = 'No file selected'; setWorkspaceMode('upload'); showAnalysisWorkspace(); renderAnalysisWorkspace(); }

$('loginForm').addEventListener('submit', submitLogin);
$('forgotPassword').onclick = forgotPassword;
$('usernameInput').addEventListener('input', e => { loginState.username = e.target.value; loginState.message = ''; syncLoginValidation(''); });
$('passwordInput').addEventListener('input', e => { loginState.password = e.target.value; loginState.message = ''; syncLoginValidation(''); });
$('usernameInput').addEventListener('blur', () => { loginState.touched.username = true; syncLoginValidation(''); });
$('passwordInput').addEventListener('blur', () => { loginState.touched.password = true; syncLoginValidation(''); });
$('togglePassword').onclick = () => { const input = $('passwordInput'); const showing = input.type === 'text'; input.type = showing ? 'password' : 'text'; $('togglePassword').setAttribute('aria-pressed', String(!showing)); $('togglePassword').setAttribute('aria-label', showing ? 'Show password' : 'Hide password'); };
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => button.closest('.modal-backdrop')?.classList.add('hidden')));
$('logoutButton').onclick = logout;

$('autocollectInput').addEventListener('change', e => { app.autocollectFile = e.target.files[0] || null; $('autocollectName').textContent = app.autocollectFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('rulesInput').addEventListener('change', e => { app.rulesFile = e.target.files[0] || null; $('rulesName').textContent = app.rulesFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('startAnalysis').onclick = startAnalysis;
$('cancelAnalysis').onclick = cancelAnalysis;
$('openRadar').onclick = showServiceRadar;
$('viewDiagnosticsReady').onclick = openDiagnostics;
$('viewDiagnosticsFailed').onclick = openDiagnostics;
$('diagnosticsFromAnalysis').onclick = openDiagnostics;
$('diagnosticsFromRadar').onclick = openDiagnostics;
$('diagnosticsFromDrill').onclick = openDiagnostics;
$('backToAnalysis').onclick = showAnalysisWorkspace;
$('backToRadar').onclick = showServiceRadar;
$('resetReady').onclick = resetAnalysis;
$('resetFailed').onclick = resetAnalysis;
$('resetUpload').onclick = resetAnalysis;
$('resetFromRadar').onclick = resetAnalysis;
$('resetFromDiagnostics').onclick = resetAnalysis;
$('showIssues').onclick = () => { app.systemFilter = 'issues'; $('showIssues').setAttribute('aria-pressed', 'true'); $('showAllSystems').setAttribute('aria-pressed', 'false'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('showAllSystems').onclick = () => { app.systemFilter = 'all'; $('showIssues').setAttribute('aria-pressed', 'false'); $('showAllSystems').setAttribute('aria-pressed', 'true'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('closeDiagnostics').onclick = () => app.lastView === 'radar' ? showServiceRadar() : app.lastView === 'drilldown' ? showDrilldown() : showAnalysisWorkspace();

syncLoginValidation('');
renderAnalysisWorkspace();
if (app.session) { const userPill = document.querySelector('.user-pill'); if (userPill) userPill.textContent = app.session.username || AUTH_CONFIG.username; showAnalysisWorkspace(); } else { show('loginView'); }
