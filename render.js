import { MACHINE_IMAGE_SRC, STATUS_LABEL, STATUS_PRIORITY, SYSTEM_HOTSPOTS } from './config.js';
import { formatRange } from './evaluation.js';

const $ = id => document.getElementById(id);
const fmtNum = v => Number.isFinite(v) ? Number(v).toFixed(2).replace(/\.00$/, '') : '—';
const fmtTime = ms => Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—';
const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${(ms / 3600000).toFixed(1)}h`;
const statusClass = s => String(s || 'no_data').replace(/_/g, '-');

export function chooseInitialSystem(result) {
  const health = result?.systemHealth || [];
  const order = ['critical', 'warning', 'needs_validation', 'needs_configuration', 'evaluator_pending', 'ok', 'no_data'];
  for (const status of order) {
    const found = health.find(h => h.status === status && (status !== 'no_data' || h.rules > 0));
    if (found) return found.system;
  }
  return health[0]?.system || Object.keys(SYSTEM_HOTSPOTS)[0] || null;
}

export function validateAnalysisResult(result) {
  const required = ['metadata', 'systemHealth', 'deviationEvents', 'signalSummaries', 'chartSeries', 'stateTimeline', 'diagnosticsSummary'];
  const missing = required.filter(key => !(key in (result || {})));
  if (missing.length) return { valid: false, reason: `Invalid AnalysisResult. Missing: ${missing.join(', ')}` };
  if (!Array.isArray(result.systemHealth) || !Array.isArray(result.deviationEvents) || !Array.isArray(result.signalSummaries)) return { valid: false, reason: 'Invalid AnalysisResult collection schema.' };
  if (!result.metadata.rulesValid) return { valid: false, reason: 'No valid rules are available for evaluation.' };
  if (!result.metadata.relevantValuesFound) return { valid: false, reason: result.metadata.blockingReason || 'No relevant source values were found.' };
  if (!result.metadata.classifiedPoints) return { valid: false, reason: result.metadata.blockingReason || 'Matching source rows were found, but no evaluation classification was produced.' };
  if ((result.metadata.blockedPoints || 0) > 0) return { valid: true, status: 'completed_with_warnings', reason: 'Matching values were found, but some or all evaluations require validation.' };
  return { valid: true, status: 'completed', reason: '' };
}

export function renderServiceRadar(app, handlers) {
  const result = app.analysisResult;
  if (!result) { renderRadarEmpty('Run an analysis to evaluate machine systems.'); return; }
  $('radarSubtitle').textContent = result.metadata.timeRange || 'No evaluated time range';
  renderKpis(result);
  renderMachineMap(result, app, handlers);
  renderActiveIssue(result, app.selectedEventId, handlers);
  renderTimeline(result, app.selectedEventId, handlers);
  renderEvidence(result);
  renderActions(result);
}


function renderRadarEmpty(message) {
  $('radarSubtitle').textContent = 'Not analyzed';
  $('kpiRow').innerHTML = '';
  $('machineMap').innerHTML = `<div class="empty-state"><h2>${message}</h2><p class="muted">No system will be labeled No Rule until an analysis result exists.</p></div>`;
  $('activeIssue').innerHTML = `<div class="empty-state"><h2>Not analyzed</h2><p class="muted">Upload a Rules Excel and autocollect ZIP first.</p></div>`;
  $('deviationTimeline').innerHTML = '';
  $('evidenceSummary').innerHTML = '';
  $('serviceActions').innerHTML = '';
}

function renderKpis(result) {
  const systemsAtRisk = result.systemHealth.filter(s => ['critical', 'warning'].includes(s.status)).length;
  const critical = result.deviationEvents.filter(e => e.severity === 'critical').length;
  const signalCoverage = `${result.metadata.relevantSignalsFound || 0} / ${result.metadata.relevantSignalsRequired || 0}`;
  const fullyEvaluated = `${result.metadata.rulesEvaluated || 0} / ${result.metadata.rulesValid || 0}`;
  $('kpiRow').innerHTML = [
    kpi('Systems at risk', systemsAtRisk),
    kpi('Critical alerts', critical),
    kpi('Signal Match Coverage', signalCoverage),
    kpi('Rules Fully Evaluated', fullyEvaluated),
    kpi('Values Requiring Validation', result.metadata.needsValidationPoints || 0),
    kpi('Values Requiring Configuration', result.metadata.needsConfigurationPoints || 0)
  ].join('');
}
function kpi(label, value) { return `<article class="kpi-card"><span>${label}</span><strong>${value}</strong></article>`; }

function renderMachineMap(result, app, handlers) {
  const healthBySystem = Object.fromEntries(result.systemHealth.map(h => [h.system, h]));
  const systems = Object.keys(SYSTEM_HOTSPOTS).filter(system => app.systemFilter === 'all' || !['ok', 'no_rule'].includes(healthBySystem[system]?.status || 'no_rule'));
  $('machineMap').innerHTML = `
    <div class="machine-backdrop"><div class="floor-reflection"></div><img class="machine-image" src="${MACHINE_IMAGE_SRC}" alt="Landa Digital Printing machine" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">${machineFallbackSvg('machine-fallback')}</div>
    <div class="hotspot-layer">${systems.map(system => hotspot(system, healthBySystem[system])).join('')}</div>`;
  $('machineMap').querySelectorAll('[data-system]').forEach(el => el.addEventListener('click', () => handlers.openDrilldown(el.dataset.system)));
}

function machineFallbackSvg(className, compact = false) {
  const viewBox = compact ? '0 0 720 260' : '0 0 1100 420';
  const scale = compact ? 'scale(.66) translate(35 20)' : '';
  return `<svg class="${className}" viewBox="${viewBox}" role="img" aria-label="Inline SVG fallback of a long Landa industrial digital printing machine" hidden>
    <defs>
      <linearGradient id="machineBody" x1="0" x2="1"><stop offset="0" stop-color="#3b4652"/><stop offset=".55" stop-color="#202a35"/><stop offset="1" stop-color="#111923"/></linearGradient>
      <linearGradient id="machineTop" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5d6975"/><stop offset="1" stop-color="#252f3a"/></linearGradient>
      <filter id="softShadow"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#000" flood-opacity=".42"/></filter>
    </defs>
    <g transform="${scale}" filter="url(#softShadow)">
      <ellipse cx="560" cy="344" rx="440" ry="36" fill="rgba(0,0,0,.34)"/>
      <path d="M96 244 L162 156 L332 118 L888 136 Q958 140 988 196 L1014 278 Q1020 300 998 306 L130 306 Q84 304 96 244Z" fill="url(#machineBody)" stroke="rgba(238,246,255,.22)" stroke-width="4"/>
      <path d="M146 222 L194 162 Q214 139 248 135 L328 128 L306 230 Z" fill="#f7fbff" opacity=".96"/>
      <path d="M176 214 L212 170 Q228 153 254 150 L300 146 L286 215 Z" fill="#16202b" stroke="#e9f5ff" stroke-width="5"/>
      <path d="M332 128 L858 142 Q912 145 938 184 L970 246 L310 246 Z" fill="url(#machineTop)" opacity=".96"/>
      <path d="M330 166 H880" stroke="#42d6ff" stroke-width="12" stroke-linecap="round" opacity=".88"/>
      <path d="M356 198 H850" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/>
      <g fill="#101820" stroke="rgba(238,246,255,.18)" stroke-width="3"><rect x="360" y="206" width="96" height="72" rx="10"/><rect x="480" y="206" width="96" height="72" rx="10"/><rect x="600" y="206" width="96" height="72" rx="10"/><rect x="720" y="206" width="96" height="72" rx="10"/></g>
      <path d="M846 164 Q930 170 954 226 L974 278 H858 Z" fill="#151f2a"/>
      <g fill="#0b1118"><circle cx="196" cy="314" r="22"/><circle cx="382" cy="314" r="22"/><circle cx="738" cy="314" r="22"/><circle cx="928" cy="314" r="22"/></g>
    </g>
  </svg>`;
}


function hotspot(system, health = { status: 'no_rule', label: 'Rules not configured' }) {
  const cfg = SYSTEM_HOTSPOTS[system];
  if (!cfg) return '';
  const cls = statusClass(health.status);
  const ax = cfg.anchorX ?? cfg.x; const ay = cfg.anchorY ?? cfg.y;
  const dx = cfg.labelX - ax; const dy = cfg.labelY - ay;
  return `<button class="hotspot ${cls} ${cfg.side || 'right'}" data-system="${system}" style="--x:${ax}%;--y:${ay}%;--lx:${cfg.labelX}%;--ly:${cfg.labelY}%;--dx:${dx}%;--dy:${dy}%"><span class="node"></span><span class="connector"></span><span class="label-card"><b>${system}</b><small>${STATUS_LABEL[health.status] || health.status}</small></span></button>`;
}


function selectedEvent(result, id) { return result.deviationEvents.find(e => e.id === id) || result.deviationEvents[0] || null; }
function selectedBlocker(result) {
  return (result.signalSummaries || []).find(s => ['needs_validation', 'needs_configuration', 'evaluator_pending'].includes(s.status) && s.matchedRows > 0) || null;
}
function blockerLabel(key) { return ({ invalid_timestamp: 'Invalid timestamp', no_numeric_value: 'No numeric value', missing_state: 'Missing Machine State', missing_expected_value: 'Missing expected value for current state', missing_threshold_or_tolerance: 'Rule has no tolerance or thresholds', unsupported_evaluator: 'Unsupported check type' })[key] || key || 'Needs validation'; }
function renderActiveIssue(result, selectedId) {
  const event = selectedEvent(result, selectedId);
  if (!event) {
    const blocker = selectedBlocker(result);
    if (blocker) {
      $('activeIssue').innerHTML = `<div class="issue-head ${statusClass(blocker.status)}"><span>${STATUS_LABEL[blocker.status]}</span><h2>${blocker.system} · ${blocker.subsystem || 'No subsystem'}</h2><p>${blocker.signal}</p></div>
        <div class="comparison-grid"><div class="comparison"><span>Actual</span><strong>${fmtNum(blocker.latestActual)}</strong></div><div class="comparison"><span>State</span><strong>${blocker.currentSystemState || blocker.currentMachineState || '—'}</strong></div><div class="comparison"><span>Rule row</span><strong>${blocker.ruleRow || '—'}</strong></div></div>
        <div class="issue-facts"><div><span>Raw timestamp</span><b>${blocker.rawTimestamp || blocker.firstRawTimestamp || '—'}</b></div><div><span>Timestamp status</span><b>${blocker.timestampStatus || '—'}</b></div><div><span>Source file</span><b>${blocker.sourceFile || '—'}</b></div><div><span>Rule row</span><b>${blocker.ruleRow || '—'}</b></div></div>
        <div class="action-box"><span>Required correction</span><strong>${blocker.blocker === 'invalid_timestamp' ? 'Support timestamp format MM/DD/YYYY HH:mm:ss:ffffff.' : blocker.status === 'needs_configuration' ? 'Configure Expected Printing and Spec Tolerance in the Rules Excel.' : blocker.latestReason || blockerLabel(blocker.blocker)}</strong></div>`;
      return;
    }
    $('activeIssue').innerHTML = `<div class="empty-state"><p class="brand-eyebrow">Active Issue</p><h2>No active deviation detected</h2><p class="muted">No fake alerts are generated. Missing values remain missing.</p></div>`;
    return;
  }
  const deviation = event.latestActual > event.expectedHigh ? event.latestActual - event.expectedHigh : event.latestActual < event.expectedLow ? event.latestActual - event.expectedLow : 0;
  const series = result.chartSeries[result.signalSummaries.find(s => s.system === event.system && s.signal === event.signal)?.ruleId] || [];
  $('activeIssue').innerHTML = `
    <div class="issue-head ${statusClass(event.severity)}"><span>${STATUS_LABEL[event.severity]}</span><h2>${event.system} · ${event.subsystem || 'No subsystem'}</h2><p>${event.signal}</p></div>
    <div class="comparison-grid"><div class="comparison"><span>Actual</span><strong>${fmtNum(event.latestActual)}</strong></div><div class="comparison"><span>Expected</span><strong>${formatRange(event.expectedLow, event.expectedHigh)}</strong></div><div class="comparison"><span>Deviation</span><strong>${deviation > 0 ? '+' : ''}${fmtNum(deviation)}</strong></div></div>
    ${sparkline(series, event)}
    <div class="issue-facts"><div><span>Machine state</span><b>${event.machineStatesSeen?.at(-1) || '—'}</b></div><div><span>System state</span><b>${event.systemStatesSeen?.at(-1) || '—'}</b></div><div><span>Duration</span><b>${fmtDuration(event.durationMs)}</b></div><div><span>First detected</span><b>${fmtTime(event.startTimestampMs)}</b></div><div><span>Last detected</span><b>${fmtTime(event.endTimestampMs)}</b></div><div><span>Data points</span><b>${event.pointCount}</b></div></div>
    <div class="action-box"><span>Recommended action</span><strong>${event.recommendedAction || 'No configured action for this rule'}</strong></div>`;
}
function sparkline(series, event) {
  if (!series.length) return '<div class="sparkline empty">No chart samples available</div>';
  const pts = series.slice(-80); const ys = pts.flatMap(p => [p.actual, p.expectedLow, p.expectedHigh].filter(Number.isFinite)); const min = Math.min(...ys); const max = Math.max(...ys); const span = max - min || 1;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${i / Math.max(1, pts.length - 1) * 100} ${100 - ((p.actual - min) / span * 80 + 10)}`).join(' ');
  const yLow = 100 - ((event.expectedLow - min) / span * 80 + 10); const yHigh = 100 - ((event.expectedHigh - min) / span * 80 + 10);
  return `<svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="${Math.min(yLow, yHigh)}" width="100" height="${Math.abs(yHigh - yLow)}" class="band"></rect><path d="${path}" class="actual-line"></path></svg>`;
}

function renderTimeline(result, selectedId, handlers) {
  const start = result.metadata.startTimestampMs; const end = result.metadata.endTimestampMs; const span = Math.max(1, end - start);
  const stateSegments = (result.stateTimeline || []).map(seg => `<span class="state-segment" style="left:${(seg.startMs - start) / span * 100}%;width:${Math.max(.4, (seg.endMs - seg.startMs) / span * 100)}%">${seg.label}</span>`).join('');
  const markers = result.deviationEvents.slice(0, 50).map(e => `<button class="deviation-marker ${statusClass(e.severity)} ${e.id === selectedId ? 'selected' : ''}" data-event="${e.id}" style="left:${(e.startTimestampMs - start) / span * 100}%" title="${e.system} ${e.signal}"></button>`).join('');
  $('deviationTimeline').innerHTML = `<div class="time-axis"><span>${fmtTime(start)}</span><span>${fmtTime(end)}</span></div><div class="ops-timeline">${stateSegments}${markers}</div><div class="legend"><span>Machine states</span><span>Deviation markers</span></div>`;
  $('deviationTimeline').querySelectorAll('[data-event]').forEach(el => el.addEventListener('click', () => handlers.selectEvent(el.dataset.event)));
}

function renderEvidence(result) {
  const rows = result.evidence || [];
  $('evidenceSummary').innerHTML = rows.length ? rows.slice(0, 5).map(p => `<div class="compact-item ${statusClass(p.result)}"><strong>${p.system} · ${p.signal}</strong><span>${fmtTime(p.timestampMs)}</span><small>Actual ${fmtNum(p.actual)} · Expected ${p.expected || formatRange(p.expectedLow, p.expectedHigh)} · ${STATUS_LABEL[p.result] || p.result}</small></div>`).join('') : `<div class="compact-item">No evaluated values</div>`;
}

function renderActions(result) {
  const actions = [];
  for (const event of result.deviationEvents) if (!actions.includes(event.recommendedAction || 'No configured action for this rule')) actions.push(event.recommendedAction || 'No configured action for this rule');
  const invalid = result.diagnosticsSummary?.ruleParsing?.invalidRules?.length;
  const topBlocker = result.diagnosticsSummary?.evaluationBlockers?.topBlocker;
  if (topBlocker) actions.push(`Resolve evaluation blocker: ${topBlocker.label}.`);
  if (invalid) actions.push('Validate incomplete or unsupported rules in the Rules Excel.');
  $('serviceActions').innerHTML = (actions.slice(0, 3).length ? actions.slice(0, 3) : ['No configured action for this rule']).map((a, i) => `<div class="compact-item"><strong>${i + 1}. ${a}</strong></div>`).join('');
}

export function renderDrilldown(app, handlers) {
  const result = app.analysisResult; const system = app.selectedSystem || chooseInitialSystem(result);
  const health = result.systemHealth.find(h => h.system === system) || { status: 'no_rule', label: 'Rules not configured' };
  const summaries = result.signalSummaries.filter(s => s.system === system).sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status]);
  const selected = summaries.find(s => s.ruleId === app.selectedRuleId) || summaries[0];
  const chart = selected ? result.chartSeries[selected.ruleId] || [] : [];
  const emptyMessage = health.status === 'no_rule' ? 'No rules configured for this system.' : health.status === 'no_data' ? 'Rules exist, but no matching source values were found.' : health.status === 'needs_validation' ? 'Values exist, but evaluation is blocked by incomplete state, expected value, timestamp, or evaluator context.' : 'No signal selected';
  $('drillSubtitle').textContent = `${system || 'No system selected'} · ${STATUS_LABEL[health.status] || health.status}`;
  $('drilldownRoot').innerHTML = `
    <aside class="drill-left panel pad"><h2>${system || 'No system selected'}</h2><p class="muted">${health.label || 'Focused investigation'}</p><div class="mini-context"><span>Rules ${health.rules || 0}</span><span>Evaluated ${health.evaluated || 0}</span><span>Deviations ${health.deviations || 0}</span></div><h3>Subsystems / Components</h3>${[...new Set(summaries.map(s => s.subsystem || s.component || 'Unmapped'))].map(x => `<button class="ghost">${x}</button>`).join('')}</aside>
    <section class="drill-center panel pad"><div class="subsystem-visual"><img class="machine-image" src="${MACHINE_IMAGE_SRC}" alt="Landa Digital Printing machine" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">${machineFallbackSvg('machine-fallback compact', true)}</div><h3>Parameters</h3><div class="param-list">${summaries.map(s => parameterCard(s, selected?.ruleId)).join('') || `<div class="compact-item">${emptyMessage}</div>`}</div></section>
    <aside class="drill-right panel pad"><h2>${selected?.signal || emptyMessage}</h2>${chartSvg(chart, selected)}${eventDetails(result, selected)}</aside>
    <section class="drill-bottom panel pad"><h3>Deviations and related rules</h3>${result.deviationEvents.filter(e => e.system === system).slice(0, 8).map(e => `<div class="compact-item ${statusClass(e.severity)}"><strong>${e.signal}</strong><small>${fmtTime(e.startTimestampMs)} · ${fmtDuration(e.durationMs)} · Rule row ${e.ruleRow}</small></div>`).join('') || '<div class="compact-item">No active deviation detected</div>'}</section>`;
  $('drilldownRoot').querySelectorAll('[data-rule]').forEach(el => el.addEventListener('click', () => handlers.selectRule(el.dataset.rule)));
}
function parameterCard(s, selectedId) { const range = Number.isFinite(s.expectedLow) || Number.isFinite(s.expectedHigh) ? formatRange(s.expectedLow, s.expectedHigh) : 'Expected: Not configured'; return `<button class="param-card ${statusClass(s.status)}" data-rule="${s.ruleId}" aria-pressed="${s.ruleId === selectedId}"><span><b>${s.signal}</b><small>${s.component || 'No component'} · ${STATUS_LABEL[s.status] || s.status}</small><small>State ${s.currentSystemState || s.currentMachineState || '—'} · Rule row ${s.ruleRow}</small></span><span><b>${fmtNum(s.latestActual)}</b><small>${range}</small><small>${s.eventCount} events · ${fmtDuration(s.totalDeviationDurationMs)}</small></span></button>`; }
function chartSvg(chart, selected) {
  if (!chart.length) return '<div class="chart-empty">No chart samples available for this parameter yet</div>';
  const ys = chart.flatMap(p => [p.actual, p.expectedLow, p.expectedHigh].filter(Number.isFinite)); const min = Math.min(...ys); const max = Math.max(...ys); const span = max - min || 1;
  const path = chart.filter(p => Number.isFinite(p.actual)).map((p, i, rows) => `${i ? 'L' : 'M'} ${40 + i / Math.max(1, rows.length - 1) * 520} ${260 - ((p.actual - min) / span * 220)}`).join(' ');
  const hasRange = Number.isFinite(selected?.expectedLow) || Number.isFinite(selected?.expectedHigh);
  return `<div class="chart-banner">${hasRange ? `Expected ${formatRange(selected.expectedLow, selected.expectedHigh)}` : selected?.blocker === 'missing_state' ? 'Machine State context is unavailable.' : 'Expected range is not configured for this rule.'}</div><svg class="big-chart" viewBox="0 0 600 300"><path d="${path}" class="actual-line"></path><text x="40" y="24">Actual value trend</text></svg>`;
}
function eventDetails(result, selected) { const ev = selected && result.deviationEvents.find(e => e.system === selected.system && e.signal === selected.signal); if (ev) return `<div class="action-box"><strong>${STATUS_LABEL[ev.severity]} event</strong><span>${fmtTime(ev.startTimestampMs)} · ${fmtDuration(ev.durationMs)}</span><p>${ev.recommendedAction || 'No configured action for this rule'}</p></div>`; if (selected && ['needs_validation', 'needs_configuration', 'evaluator_pending'].includes(selected.status)) return `<div class="action-box"><strong>${STATUS_LABEL[selected.status]}</strong><span>Actual ${fmtNum(selected.latestActual)} · Rule row ${selected.ruleRow}</span><p>${selected.latestReason || blockerLabel(selected.blocker)}</p></div>`; return '<div class="action-box">No active deviation detected</div>'; }

export function renderDiagnostics(result) {
  const d = result?.diagnosticsSummary;
  if (!d) { $('diagnosticsPre').textContent = 'No diagnostics available.'; return; }
  $('diagnosticsPre').textContent = JSON.stringify({ timestampParsing: d.timestampParsing, ruleCoverage: d.ruleCoverage, dataTimeRanges: d.dataTimeRanges, sourceStats: d.sourceStats, evaluationBlockers: d.evaluationBlockers, reasons: d.reasons, parserWarnings: d.parserWarnings }, null, 2);
}
