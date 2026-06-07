import { MACHINE_IMAGE_SRC, SYSTEM_HOTSPOTS } from './config.js';
import { $, ISSUE_STATUSES, blockerLabel, chooseInitialParameter, chooseInitialSystem, compactNumber, deviationText, escapeAttr, escapeHtml, expectedText, fmtDuration, fmtNum, fmtTime, hasExpectedRange, normalizeStatus, priority, renderComparisonGauge, renderEmptyState, renderStateTimeline, renderStatusBadge, renderSystemHealthDonut, statusClass, statusIcon, statusLabel, validateAnalysisResult } from './render.js';

export { chooseInitialSystem, validateAnalysisResult } from './render.js';

export function renderServiceRadar(app, handlers) {
  const result = app.analysisResult;
  if (!result) { renderRadarEmpty('Run an analysis to evaluate machine systems.'); return; }
  if (!app.selectedSystem) app.selectedSystem = chooseInitialSystem(result);
  if (!app.selectedEventId) app.selectedEventId = result.deviationEvents?.[0]?.id || null;
  $('radarSubtitle').textContent = result.metadata.timeRange || 'No evaluated time range';
  renderKpis(result);
  renderMachineMap(result, app, handlers);
  renderActiveIssue(result, app, handlers);
  renderBottomRow(result, app, handlers);
}

function renderRadarEmpty(message) {
  $('radarSubtitle').textContent = 'Not analyzed';
  $('kpiRow').innerHTML = '';
  $('machineMap').innerHTML = renderEmptyState(message, 'Upload a Rules Excel and autocollect ZIP first.', 'not_analyzed');
  $('activeIssue').innerHTML = renderEmptyState('Not analyzed', 'No operational decision is available until an AnalysisResult exists.', 'not_analyzed');
  $('deviationTimeline').innerHTML = '';
  $('evidenceSummary').innerHTML = '';
  $('serviceActions').innerHTML = '';
}

function renderKpis(result) {
  const health = result.systemHealth || [];
  const attention = health.filter(item => ISSUE_STATUSES.has(normalizeStatus(item.status))).length;
  const critical = (result.deviationEvents || []).filter(event => normalizeStatus(event.severity) === 'critical').length;
  const warning = (result.deviationEvents || []).filter(event => normalizeStatus(event.severity) === 'warning').length;
  const validation = health.filter(item => normalizeStatus(item.status) === 'needs_validation').length;
  const configuration = health.filter(item => normalizeStatus(item.status) === 'needs_configuration').length;
  const coverage = `${result.metadata.relevantSignalsFound || 0}/${result.metadata.relevantSignalsRequired || 0}`;
  $('kpiRow').innerHTML = [
    kpi('Systems requiring attention', attention, 'Machine systems not ready', attention ? 'warning' : 'ok'),
    kpi('Critical findings', critical, 'Immediate service attention', critical ? 'critical' : 'ok'),
    kpi('Warning findings', warning, 'Outside permitted range', warning ? 'warning' : 'ok'),
    kpi('Rules fully evaluated', result.metadata.rulesEvaluated || 0, `${result.metadata.rulesValid || 0} configured valid rules`, 'ok'),
    kpi('Validation / configuration', `${validation}/${configuration}`, `${compactNumber(result.metadata.blockedPoints || 0)} values blocked`, validation ? 'needs_validation' : configuration ? 'needs_configuration' : 'ok'),
    kpi('Signal match coverage', coverage, 'Matched required signals', 'needs_validation')
  ].join('');
}

function kpi(label, value, help, status) {
  return `<article class="kpi-card ${statusClass(status)}"><div class="kpi-icon">${statusIcon(status)}</div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(help)}</small></article>`;
}

function renderMachineMap(result, app, handlers) {
  const healthBySystem = Object.fromEntries((result.systemHealth || []).map(item => [item.system, item]));
  const selectedSystem = app.selectedSystem || chooseInitialSystem(result);
  const systems = Object.keys(SYSTEM_HOTSPOTS).filter(system => {
    const status = normalizeStatus(healthBySystem[system]?.status || 'no_rule');
    return app.systemFilter === 'all' || ISSUE_STATUSES.has(status);
  });
  $('machineMap').innerHTML = `
    <div class="machine-backdrop">
      <div class="spotlight"></div><div class="floor-reflection"></div>
      <img class="machine-image" src="${MACHINE_IMAGE_SRC}" alt="Landa Digital Printing machine" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">
      ${machineFallbackSvg()}
    </div>
    <div class="hotspot-layer">${systems.map(system => renderHotspot(system, healthBySystem[system], selectedSystem, app.systemFilter)).join('')}</div>`;
  $('machineMap').querySelectorAll('[data-system]').forEach(el => el.addEventListener('click', () => {
    app.selectedSystem = el.dataset.system;
    const event = (result.deviationEvents || []).find(item => item.system === app.selectedSystem);
    app.selectedEventId = event?.id || null;
    renderServiceRadar(app, handlers);
  }));
  $('machineMap').querySelectorAll('[data-open-system]').forEach(el => el.addEventListener('dblclick', () => handlers.openDrilldown(el.dataset.openSystem)));
}

export function renderHotspot(system, health = {}, selectedSystem = '', filter = 'issues') {
  const map = SYSTEM_HOTSPOTS[system];
  const status = normalizeStatus(health?.status || 'no_rule');
  const quiet = filter === 'all' && !ISSUE_STATUSES.has(status) ? 'quiet' : '';
  const selected = system === selectedSystem ? 'selected' : '';
  const findings = health?.deviations || health?.blockedPoints || 0;
  const dxPct = map.labelX - map.anchorX;
  const dyPct = map.labelY - map.anchorY;
  const dx = dxPct * 9.8;
  const dy = dyPct * 5.8;
  const length = Math.max(28, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<button class="hotspot ${statusClass(status)} ${selected} ${quiet}" data-system="${escapeAttr(system)}" data-open-system="${escapeAttr(system)}" style="--anchor-x:${map.anchorX}%;--anchor-y:${map.anchorY}%;--lx:${dx - 54}px;--ly:${dy - 20}px;--line-length:${length}px;--line-angle:${angle}deg;" title="${escapeAttr(`${system}: ${statusLabel(status)}`)}">
    <span class="connector"></span><span class="node"><span>${statusIcon(status)}</span></span>
    <span class="label-card ${map.labelAlign || 'center'}"><b>${escapeHtml(system)}</b><small>${ISSUE_STATUSES.has(status) ? `${findings || 1} ${status === 'critical' || status === 'warning' ? 'findings' : statusLabel(status)}` : statusLabel(status)}</small></span>
  </button>`;
}

function renderActiveIssue(result, app, handlers) {
  const events = result.deviationEvents || [];
  const selectedEvent = events.find(event => event.id === app.selectedEventId);
  const selectedSystem = app.selectedSystem || selectedEvent?.system || chooseInitialSystem(result);
  const summaries = (result.signalSummaries || []).filter(row => row.system === selectedSystem).sort((a, b) => priority(b.status) - priority(a.status));
  const selectedSummary = selectedEvent ? summaries.find(row => row.signal === selectedEvent.signal) : chooseInitialParameter(result, selectedSystem);
  const item = selectedEvent || selectedSummary;
  if (!item) {
    $('activeIssue').innerHTML = renderEmptyState('No active deviation', 'All fully evaluated parameters are currently within their configured ranges.', 'ok');
    return;
  }
  const status = normalizeStatus(item.severity || item.status);
  const actual = item.latestActual ?? item.firstActual;
  const expected = { expectedLow: item.expectedLow, expectedHigh: item.expectedHigh };
  const health = (result.systemHealth || []).find(row => row.system === selectedSystem) || { system: selectedSystem, status };
  $('activeIssue').innerHTML = `<div class="issue-panel ${statusClass(status)}">
    <div class="issue-top">${renderStatusBadge(status, statusLabel(status), 'active')}<button class="primary compact-open" id="openIssueDrill">Open Drill-Down</button></div>
    <h2>${escapeHtml(item.system || selectedSystem)} <span>${escapeHtml(item.subsystem || item.component || '')}</span></h2>
    <p class="issue-signal">${escapeHtml(item.signal || selectedSummary?.signal || 'Selected parameter')}</p>
    <div class="comparison-grid">
      <div><label>Actual</label><strong>${fmtNum(actual)}</strong></div>
      <div><label>Expected</label><strong>${escapeHtml(expectedText(expected))}</strong></div>
      <div><label>Deviation</label><strong>${escapeHtml(deviationText(actual, expected))}</strong></div>
    </div>
    ${renderComparisonGauge({ actual, expectedLow: item.expectedLow, expectedHigh: item.expectedHigh, status })}
    ${renderSystemHealthDonut(health, summaries)}
    <div class="issue-facts">
      <div><label>Machine State</label><b>${escapeHtml([...(item.machineStatesSeen || [])][0] || selectedSummary?.currentMachineState || '—')}</b></div>
      <div><label>System State</label><b>${escapeHtml([...(item.systemStatesSeen || [])][0] || selectedSummary?.currentSystemState || '—')}</b></div>
      <div><label>Duration</label><b>${fmtDuration(item.durationMs || selectedSummary?.totalDeviationDurationMs)}</b></div>
      <div><label>First detected</label><b>${fmtTime(item.startTimestampMs)}</b></div>
      <div><label>Last detected</label><b>${fmtTime(item.endTimestampMs)}</b></div>
      <div><label>Rule row</label><b>${escapeHtml(item.ruleRow || selectedSummary?.ruleRow || '—')}</b></div>
    </div>
    <div class="action-box ${statusClass(status)}"><strong>Recommended action</strong><p>${escapeHtml(actionFor(item, selectedSummary, status))}</p></div>
  </div>`;
  $('openIssueDrill').onclick = () => handlers.openDrilldown(item.system || selectedSystem);
}

function actionFor(item, summary, status) {
  if (item.recommendedAction || summary?.recommendedAction) return item.recommendedAction || summary.recommendedAction;
  if (status === 'needs_configuration') return `Actual values were found. Configure Expected and Tolerance in Excel row ${item.ruleRow || summary?.ruleRow || '—'}.`;
  if (status === 'needs_validation') return summary?.latestReason || blockerLabel(summary?.blocker || item.blocker);
  if (status === 'no_data') return 'A rule exists, but no matching source values were found.';
  if (status === 'ok') return 'No service action required.';
  return 'Review the selected rule and inspect the actual value against the configured range.';
}

function renderBottomRow(result, app, handlers) {
  const events = result.deviationEvents || [];
  $('deviationTimeline').innerHTML = renderStateTimeline({ stateTimeline: result.stateTimeline || [], events, selectedEventId: app.selectedEventId, onEvent: true });
  $('deviationTimeline').querySelectorAll('[data-event]').forEach(el => el.addEventListener('click', () => handlers.selectEvent(el.dataset.event)));
  $('evidenceSummary').innerHTML = latestFindings(result);
  $('serviceActions').innerHTML = recommendedActions(result);
}

function latestFindings(result) {
  const findings = [...(result.deviationEvents || [])].sort((a, b) => (b.startTimestampMs || 0) - (a.startTimestampMs || 0)).slice(0, 5);
  if (!findings.length) return renderEmptyState('No active deviation', 'All fully evaluated parameters are currently within their configured ranges.', 'ok');
  return findings.map(event => `<button class="finding-item ${statusClass(event.severity)}" data-event-ref="${escapeAttr(event.id)}"><span>${statusIcon(event.severity)}</span><b>${fmtTime(event.startTimestampMs)}</b><strong>${escapeHtml(event.system)} · ${escapeHtml(event.signal)}</strong><small>Actual ${fmtNum(event.latestActual)} vs ${escapeHtml(expectedText(event))}</small></button>`).join('');
}

function recommendedActions(result) {
  const source = [...(result.deviationEvents || [])].filter(event => event.recommendedAction).slice(0, 3);
  const configs = (result.signalSummaries || []).filter(row => normalizeStatus(row.status) === 'needs_configuration').slice(0, 3 - source.length);
  const rows = [
    ...source.map(event => ({ system: event.system, status: event.severity, action: event.recommendedAction, impact: statusLabel(event.severity) })),
    ...configs.map(row => ({ system: row.system, status: row.status, action: `Configure Expected and Tolerance in Excel row ${row.ruleRow || '—'}.`, impact: 'Configuration required' }))
  ].slice(0, 3);
  if (!rows.length) return renderEmptyState('No service action queued', 'No active deviation or incomplete rule requires action right now.', 'ok');
  return rows.map((row, idx) => `<div class="action-row-card ${statusClass(row.status)}"><span class="priority-number">${idx + 1}</span><div><strong>${escapeHtml(row.action)}</strong><small>${escapeHtml(row.impact)} · ${escapeHtml(row.system)}</small></div></div>`).join('');
}

function machineFallbackSvg() {
  return `<svg class="machine-fallback" viewBox="0 0 1100 420" role="img" aria-label="Inline SVG fallback of a long industrial digital printing press" hidden>
    <defs><linearGradient id="body" x1="0" x2="1"><stop offset="0" stop-color="#e9eef5"/><stop offset=".22" stop-color="#f8fbff"/><stop offset=".23" stop-color="#24313f"/><stop offset="1" stop-color="#101923"/></linearGradient><linearGradient id="cyan" x1="0" x2="1"><stop offset="0" stop-color="#4fd8ff"/><stop offset="1" stop-color="#178dca"/></linearGradient></defs>
    <ellipse cx="550" cy="346" rx="470" ry="38" fill="rgba(0,0,0,.36)"/>
    <g transform="translate(70 85)">
      <path d="M60 180 L170 75 L330 72 L370 120 L940 120 L1000 172 L970 255 L112 255 Z" fill="url(#body)" stroke="#6f8196" stroke-width="3"/>
      <path d="M110 174 L186 102 L300 100 L330 134 L315 224 L108 224 Z" fill="#f7fbff" stroke="#b7c4d2" stroke-width="3"/>
      <path d="M195 116 L286 116 L306 143 L292 206 L152 206 Z" fill="#111b26" opacity=".92"/>
      <rect x="360" y="148" width="555" height="72" rx="12" fill="#162331"/><rect x="380" y="166" width="500" height="12" rx="6" fill="url(#cyan)"/>
      <rect x="410" y="92" width="80" height="42" rx="8" fill="#344555"/><rect x="510" y="92" width="96" height="42" rx="8" fill="#2a3948"/><rect x="630" y="92" width="112" height="42" rx="8" fill="#334454"/>
      <path d="M908 130 L990 176 L955 238 L890 222 Z" fill="#263747" stroke="#65798e" stroke-width="2"/><rect x="918" y="154" width="44" height="58" rx="6" fill="#0d1620"/>
      <g fill="#111923"><circle cx="195" cy="258" r="24"/><circle cx="514" cy="258" r="24"/><circle cx="850" cy="258" r="24"/></g>
      <g fill="#5d7288"><rect x="384" y="226" width="126" height="22" rx="4"/><rect x="535" y="226" width="126" height="22" rx="4"/><rect x="686" y="226" width="126" height="22" rx="4"/></g>
    </g>
  </svg>`;
}

export function renderDiagnostics(result) {
  const d = result?.diagnosticsSummary;
  if (!d) { $('diagnosticsPre').textContent = 'No diagnostics available.'; return; }
  $('diagnosticsPre').textContent = JSON.stringify({ timestampParsing: d.timestampParsing, ruleCoverage: d.ruleCoverage, dataTimeRanges: d.dataTimeRanges, sourceStats: d.sourceStats, evaluationBlockers: d.evaluationBlockers, reasons: d.reasons, parserWarnings: d.parserWarnings }, null, 2);
}
