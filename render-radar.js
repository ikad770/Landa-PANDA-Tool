import { MACHINE_IMAGE_SRC, SYSTEM_HOTSPOTS } from './config.js';
import { $, ISSUE_STATUSES, OPERATIONAL_STATUSES, blockerLabel, chooseInitialParameter, chooseInitialSystem, deviationText, escapeAttr, escapeHtml, expectedText, fmtDuration, fmtNum, fmtTime, getServiceDecision, normalizeStatus, priority, renderComparisonGauge, renderEmptyState, renderKpiCard, renderStateTimeline, renderStatusBadge, renderSystemHealthDonut, shortStatusLabel, statusClass, statusIcon, statusLabel, validateAnalysisResult } from './render.js';

export { chooseInitialSystem, validateAnalysisResult } from './render.js';

export function renderServiceRadar(app, handlers) {
  const result = app.analysisResult;
  if (!result) { renderRadarEmpty('Run an analysis to evaluate machine systems.'); return; }
  const decision = getServiceDecision(result);
  if (!app.selectedSystem) app.selectedSystem = decision.primarySystem || chooseInitialSystem(result);
  if (!app.selectedEventId) app.selectedEventId = decision.operationalFindings?.[0]?.id || null;
  $('radarSubtitle').textContent = result.metadata.timeRange || 'No evaluated time range';
  const statusNode = $('radarAnalysisStatus');
  if (statusNode) statusNode.innerHTML = renderStatusBadge(decision.machineStatus, decision.machineStatusLabel);
  const summaryNode = $('machineSummary');
  if (summaryNode) summaryNode.innerHTML = `<div class="machine-summary ${statusClass(decision.machineStatus)}">${renderStatusBadge(decision.machineStatus)}<p>${escapeHtml(decision.machineSummary)}</p><small>Systems requiring attention: ${decision.systemsRequiringAttentionCount} · Systems at risk: ${decision.systemsAtRiskCount}</small></div>`;
  renderKpis(result, decision);
  renderMachineMap(result, app, handlers, decision);
  renderActiveIssue(result, app, handlers, decision);
  renderBottomRow(result, app, handlers, decision);
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

function renderKpis(result, decision) {
  const kpis = decision.kpis || {};
  $('kpiRow').innerHTML = [
    renderKpiCard({ label: 'Systems at Risk', value: kpis.systemsAtRisk || 0, subtitle: 'Critical / Warning only', status: (kpis.systemsAtRisk || 0) ? 'warning' : 'ok', icon: '◎' }),
    renderKpiCard({ label: 'Critical Findings', value: kpis.criticalFindings || 0, subtitle: 'Active deviation events', status: (kpis.criticalFindings || 0) ? 'critical' : 'ok' }),
    renderKpiCard({ label: 'Warning Findings', value: kpis.warningFindings || 0, subtitle: 'Outside permitted range', status: (kpis.warningFindings || 0) ? 'warning' : 'ok' }),
    renderKpiCard({ label: 'Evaluation Readiness', value: `${kpis.evaluationReadiness?.evaluated || 0}/${kpis.evaluationReadiness?.total || 0}`, subtitle: 'Rules fully evaluable / valid', status: decision.analysisCompleteness?.percent === 100 ? 'ok' : 'needs_configuration', icon: '↔' }),
    renderKpiCard({ label: 'Validation / Configuration', value: `${kpis.validationIssues || 0}/${kpis.configurationIssues || 0}`, subtitle: 'Rule-level issues', status: kpis.validationIssues ? 'needs_validation' : kpis.configurationIssues ? 'needs_configuration' : 'ok', icon: '◇' }),
    renderKpiCard({ label: 'Signal Coverage', value: `${kpis.signalCoverage?.found || 0}/${kpis.signalCoverage?.required || 0}`, subtitle: 'Matched / required signals', status: (kpis.signalCoverage?.found || 0) >= (kpis.signalCoverage?.required || 1) ? 'ok' : 'no_data', icon: '⌁' })
  ].join('');
}

function renderMachineMap(result, app, handlers, decision) {
  const healthBySystem = Object.fromEntries((result.systemHealth || []).map(item => [item.system, item]));
  const selectedSystem = app.selectedSystem || decision.primarySystem || chooseInitialSystem(result);
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
    const event = (decision.operationalFindings || []).find(item => item.system === app.selectedSystem);
    app.selectedEventId = event?.id || null;
    renderServiceRadar(app, handlers);
  }));
  $('machineMap').querySelectorAll('[data-open-system]').forEach(el => el.addEventListener('dblclick', () => handlers.openDrilldown(el.dataset.openSystem)));
}

export function renderHotspot(system, health = {}, selectedSystem = '', filter = 'issues') {
  const map = SYSTEM_HOTSPOTS[system];
  const status = normalizeStatus(health?.status || 'no_rule');
  const inactive = !ISSUE_STATUSES.has(status);
  const quiet = filter === 'all' && inactive ? status === 'no_data' ? 'quiet no-data-quiet' : 'quiet no-rule-quiet' : '';
  const selected = system === selectedSystem ? 'selected' : '';
  const findings = OPERATIONAL_STATUSES.has(status) ? (health?.deviations || 1) : status === 'needs_validation' ? (health?.needsValidationRules || health?.blockedRules || 1) : status === 'needs_configuration' ? (health?.needsConfigurationRules || 1) : 0;
  const dxPct = map.labelX - map.anchorX;
  const dyPct = map.labelY - map.anchorY;
  const dx = dxPct * 9.8;
  const dy = dyPct * 5.8;
  const length = Math.max(28, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<button class="hotspot ${statusClass(status)} ${selected} ${quiet}" data-system="${escapeAttr(system)}" data-open-system="${escapeAttr(system)}" style="--anchor-x:${map.anchorX}%;--anchor-y:${map.anchorY}%;--lx:${dx - 54}px;--ly:${dy - 20}px;--line-length:${length}px;--line-angle:${angle}deg;" title="${escapeAttr(`${system}: ${statusLabel(status)}`)}">
    <span class="connector"></span><span class="node"><span>${statusIcon(status)}</span></span>
    <span class="label-card ${map.labelAlign || 'center'}"><b>${escapeHtml(system)}</b><small>${ISSUE_STATUSES.has(status) ? `${findings} ${shortStatusLabel(status)}` : shortStatusLabel(status)}</small></span>
  </button>`;
}

function renderActiveIssue(result, app, handlers, decision) {
  const selectedSystem = app.selectedSystem || decision.primarySystem || chooseInitialSystem(result);
  const events = decision.operationalFindings || [];
  const selectedEvent = events.find(event => event.id === app.selectedEventId && event.system === selectedSystem) || events.find(event => event.system === selectedSystem);
  const summaries = (result.signalSummaries || []).filter(row => row.system === selectedSystem).sort((a, b) => priority(b.status) - priority(a.status));
  const selectedSummary = selectedEvent ? summaries.find(row => row.signal === selectedEvent.signal) : chooseInitialParameter({ signalSummaries: summaries }, selectedSystem);
  const item = selectedEvent || selectedSummary;
  if (!item) {
    $('activeIssue').innerHTML = renderEmptyState('No rule configured', 'This system has no configured evaluation rules.', 'no_rule');
    return;
  }
  const status = normalizeStatus(item.severity || item.status);
  const actual = item.latestActual ?? item.firstActual;
  const health = (result.systemHealth || []).find(row => row.system === selectedSystem) || { system: selectedSystem, status };
  $('activeIssue').innerHTML = `<div class="issue-panel ${statusClass(status)}">
    <div class="issue-top">${renderStatusBadge(status, status === 'needs_configuration' ? 'Configuration Required' : statusLabel(status), 'active')}<button class="primary compact-open" id="openIssueDrill">Open Drill-Down</button></div>
    <h2>${escapeHtml(item.system || selectedSystem)} <span>${escapeHtml(item.subsystem || item.component || '')}</span></h2>
    <p class="issue-signal">${escapeHtml(item.signal || selectedSummary?.signal || 'Selected parameter')}</p>
    <div class="comparison-grid">
      <div><label>Actual</label><strong>${fmtNum(actual)}</strong></div>
      <div><label>Expected</label><strong>${escapeHtml(expectedText(item))}</strong></div>
      <div><label>Deviation</label><strong>${escapeHtml(deviationText(actual, item))}</strong></div>
    </div>
    ${Number.isFinite(actual) ? renderComparisonGauge({ actual, expectedLow: item.expectedLow, expectedHigh: item.expectedHigh, warningLow: item.warningLow, warningHigh: item.warningHigh, criticalLow: item.criticalLow, criticalHigh: item.criticalHigh, status }) : ''}
    ${renderSystemHealthDonut(health, summaries)}
    <div class="issue-facts">
      <div><label>Machine State</label><b>${escapeHtml([...(item.machineStatesSeen || [])][0] || selectedSummary?.currentMachineState || '—')}</b></div>
      <div><label>System State</label><b>${escapeHtml([...(item.systemStatesSeen || [])][0] || selectedSummary?.currentSystemState || '—')}</b></div>
      <div><label>Duration</label><b>${fmtDuration(item.durationMs || selectedSummary?.totalDeviationDurationMs)}</b></div>
      <div><label>First detected</label><b>${fmtTime(item.startTimestampMs)}</b></div>
      <div><label>Last detected</label><b>${fmtTime(item.endTimestampMs)}</b></div>
      <div><label>Rule row</label><b>${escapeHtml(item.ruleRow || selectedSummary?.ruleRow || '—')}</b></div>
    </div>
    <div class="action-box ${statusClass(status)}"><strong>${status === 'needs_configuration' ? 'Required configuration action' : status === 'needs_validation' ? 'Required validation action' : 'Recommended action'}</strong><p>${escapeHtml(actionFor(item, selectedSummary, status, decision))}</p></div>
  </div>`;
  $('openIssueDrill').onclick = () => handlers.openDrilldown(item.system || selectedSystem);
}

function actionFor(item, summary, status, decision) {
  if (['critical', 'warning'].includes(status) && (item.recommendedAction || summary?.recommendedAction)) return item.recommendedAction || summary.recommendedAction;
  if (status === 'needs_configuration') return decision.nextRecommendedAction || `Update Excel row ${item.ruleRow || summary?.ruleRow || '—'} with Expected value and Spec Tolerance.`;
  if (status === 'needs_validation') return decision.nextRecommendedAction || summary?.latestReason || blockerLabel(summary?.blocker || item.blocker);
  if (status === 'no_data') return 'A valid rule exists, but no matching signal was found in the uploaded logs.';
  if (status === 'ok') return 'No service action is required for fully evaluated parameters.';
  return decision.nextRecommendedAction || 'Review the selected rule and inspect the actual value against the configured range.';
}

function renderBottomRow(result, app, handlers, decision) {
  const events = decision.operationalFindings || [];
  $('deviationTimeline').innerHTML = renderStateTimeline({ stateTimeline: result.stateTimeline || [], events, selectedEventId: app.selectedEventId, onEvent: true });
  $('deviationTimeline').querySelectorAll('[data-event]').forEach(el => el.addEventListener('click', () => handlers.selectEvent(el.dataset.event)));
  $('evidenceSummary').innerHTML = latestFindings(result, decision);
  $('serviceActions').innerHTML = recommendedActions(decision);
}

function latestFindings(result, decision) {
  const findings = [...(decision.operationalFindings || [])].sort((a, b) => (b.startTimestampMs || 0) - (a.startTimestampMs || 0)).slice(0, 5);
  if (!findings.length) {
    if (decision.configurationProblems.length) return renderEmptyState('Configuration required', `Actual values were found for ${decision.configurationProblems.length} rule${decision.configurationProblems.length === 1 ? '' : 's'}, but their rules are incomplete.`, 'needs_configuration');
    if (decision.validationProblems.length) return renderEmptyState('Validation required', `Matching source values were found, but ${decision.validationProblems.length} rule${decision.validationProblems.length === 1 ? '' : 's'} need corrected context.`, 'needs_validation');
    return renderEmptyState('No active operational issue', 'All fully evaluated parameters are currently inside their configured ranges.', 'ok');
  }
  return findings.map(event => `<button class="finding-item ${statusClass(event.severity)}" data-event-ref="${escapeAttr(event.id)}"><span>${statusIcon(event.severity)}</span><b>${fmtTime(event.startTimestampMs)}</b><strong>${escapeHtml(event.system)} · ${escapeHtml(event.signal)}</strong><small>Actual ${fmtNum(event.latestActual)} vs ${escapeHtml(expectedText(event))}</small></button>`).join('');
}

function recommendedActions(decision) {
  const rows = [];
  if (decision.nextRecommendedAction) rows.push({ system: decision.primarySystem || 'Machine', status: decision.machineStatus, action: decision.nextRecommendedAction, impact: decision.machineStatusLabel });
  for (const event of (decision.operationalFindings || []).filter(event => event.recommendedAction)) rows.push({ system: event.system, status: event.severity, action: event.recommendedAction, impact: statusLabel(event.severity) });
  for (const row of (decision.configurationProblems || [])) rows.push({ system: row.system, status: row.status, action: `Update Excel row ${row.ruleRow || '—'} with Expected value and Spec Tolerance.`, impact: 'Configuration required' });
  if (!rows.length) return renderEmptyState('No service action required', 'No active deviation or incomplete rule requires action right now.', 'ok');
  return rows.slice(0, 3).map((row, idx) => `<div class="action-row-card ${statusClass(row.status)}"><span class="priority-number">${idx + 1}</span><div><strong>${escapeHtml(row.action)}</strong><small>${escapeHtml(row.impact)} · ${escapeHtml(row.system)}</small></div></div>`).join('');
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
