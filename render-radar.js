import { STATUS_PRIORITY } from './config.js';
import { escapeAttribute, escapeHtml, fmtDuration, fmtNum, fmtTime, renderStatusBadge, statusClass, statusLabel } from './render.js';

export function validateAnalysisResult(result) {
  if (!result || result.schemaVersion !== '2.0') return { valid: false, reason: 'Worker did not return a V2 result.' };
  const arrays = ['signalCatalog', 'parameterSummaries', 'systems', 'stateTimeline'];
  const missing = arrays.filter(key => !Array.isArray(result[key]));
  if (missing.length) return { valid: false, reason: `Invalid V2 result. Missing arrays: ${missing.join(', ')}` };
  return { valid: true, status: 'completed', reason: '' };
}

export function chooseInitialSystem(result) {
  return result?.systems?.[0]?.systemName || null;
}

export function renderDiagnostics(result) {
  const pre = document.getElementById('diagnosticsPre');
  if (!pre) return;
  pre.textContent = JSON.stringify({ metadata: result?.metadata || null, summary: result?.summary || null, diagnostics: result?.diagnostics || result?.error || null }, null, 2);
}

export function renderServiceRadar(app) {
  const result = app.analysisResult;
  if (!result) return;
  const root = document.querySelector('#radarView .shell');
  root.innerHTML = `<header class="radar-header service-header">
    <div class="service-brand"><span class="brand-mark">P</span><div><p class="brand-eyebrow">PANDA Tool</p><h1>Results Workspace</h1><small>Stable V2 Manager Demo MVP</small></div></div>
    <nav class="nav-pills service-nav"><button id="backToAnalysis">Analysis</button><button id="diagnosticsFromRadar">Diagnostics</button><button id="resetFromRadar" class="ghost">New Analysis</button></nav>
    <div class="status-area service-actions"><span>Schema ${escapeHtml(result.schemaVersion)}</span><strong>Analysis completed</strong><span class="user-pill">Local</span></div>
  </header>
  <section id="v2ResultsRoot" class="v2-results"></section>`;
  document.getElementById('backToAnalysis').onclick = () => window.dispatchEvent(new CustomEvent('panda:navigate-analysis'));
  document.getElementById('diagnosticsFromRadar').onclick = () => window.dispatchEvent(new CustomEvent('panda:diagnostics'));
  document.getElementById('resetFromRadar').onclick = () => window.dispatchEvent(new CustomEvent('panda:reset'));
  initResultsWorkspace(result);
}

function initResultsWorkspace(result) {
  const root = document.getElementById('v2ResultsRoot');
  const state = { query: '', source: 'all', coverage: 'all', selectedId: result.signalCatalog[0]?.signalId || null, selectedIds: new Set([result.signalCatalog[0]?.signalId].filter(Boolean)), expandedSystems: new Set((result.signalHierarchy || []).slice(0, 3).map(system => system.systemId)), expandedComponents: new Set() };
  const sources = Array.from(new Set(result.signalCatalog.map(signal => signal.sourceName))).sort();
  root.innerHTML = `${renderTopSummary(result)}
  <section class="results-grid">
    <aside class="panel signal-explorer"><div class="panel-title"><h2>Signal Explorer</h2></div>
      <input id="signalSearch" class="search-input" placeholder="Search signals">
      <select id="sourceFilter"><option value="all">All sources</option>${sources.map(source => `<option>${escapeHtml(source)}</option>`).join('')}</select>
      <select id="coverageFilter"><option value="all">All coverage</option><option value="rule">Rule</option><option value="no_rule">No Rule</option></select>
      <div class="selection-actions"><button id="clearSignalSelection" class="text-button">Clear selection</button><span id="selectionCount" class="tiny">0 selected</span></div><div id="signalList" class="signal-list"></div>
    </aside>
    <main class="panel trend-panel"><div class="panel-title"><h2 id="selectedSignalTitle">Selected signal</h2><span id="selectedSignalBadge"></span></div><div id="signalChart"></div><div id="stateTimeline" class="state-timeline"></div><div id="signalMetrics" class="metric-grid"></div></main>
    <aside class="panel analysis-summary"><div class="panel-title"><h2>Analysis Summary</h2></div><div id="parameterSummary"></div></aside>
  </section>
  <section class="panel system-overview"><div class="panel-title"><h2>Basic System Overview</h2></div><div class="system-card-grid">${result.systems.map(renderSystemCard).join('')}</div></section>`;
  const render = () => renderSelection(result, state);
  document.getElementById('signalSearch').oninput = event => { state.query = event.target.value; render(); };
  document.getElementById('sourceFilter').onchange = event => { state.source = event.target.value; render(); };
  document.getElementById('coverageFilter').onchange = event => { state.coverage = event.target.value; render(); };
  document.getElementById('clearSignalSelection').onclick = () => { state.selectedIds.clear(); state.selectedId = null; render(); };
  render();
}

function renderTopSummary(result) {
  const s = result.summary;
  const m = result.metadata;
  return `<section class="panel top-summary"><div><p class="brand-eyebrow">Analysis completed</p><h2>${fmtTime(m.selectedRange.startTimestampMs)} → ${fmtTime(m.selectedRange.endTimestampMs)}</h2><small>Files processed: ${m.filesProcessed} · Rows processed: ${m.rowsProcessed}</small></div>
  ${summaryMetric('Discovered', s.discoveredSignals)}${summaryMetric('Configured / Evaluated', `${s.configuredSignals} / ${s.evaluatedSignals}`)}${summaryMetric('Warning / Critical / OK', `${s.warningParameters} / ${s.criticalParameters} / ${s.okParameters}`)}${summaryMetric('No Rule / No Data / Config', `${s.noRuleSignals} / ${s.noDataRules} / ${s.configurationIssues}`)}</section>`;
}

function summaryMetric(label, value) {
  return `<div class="metric"><label>${escapeHtml(label)}</label><b>${escapeHtml(value)}</b></div>`;
}

function renderSelection(result, state) {
  const filteredSignals = result.signalCatalog.filter(signal => matchesSignalFilter(signal, state));
  const filteredIds = new Set(filteredSignals.map(signal => signal.signalId));
  for (const id of Array.from(state.selectedIds)) if (!filteredIds.has(id)) state.selectedIds.delete(id);
  if (!state.selectedIds.size && filteredSignals[0]) state.selectedIds.add(filteredSignals[0].signalId);
  state.selectedId = Array.from(state.selectedIds)[0] || null;
  document.getElementById('selectionCount').textContent = `${state.selectedIds.size} selected`;
  document.getElementById('signalList').innerHTML = renderSignalHierarchy(result, state, filteredIds);
  bindNavigatorEvents(result, state);

  const selectedSignals = Array.from(state.selectedIds).map(id => result.signalCatalog.find(item => item.signalId === id)).filter(Boolean);
  const visibleSignals = selectedSignals.slice(0, 12);
  const primary = visibleSignals[0];
  const primaryParameter = result.parameterSummaries.find(item => item.signalId === primary?.signalId);
  if (!primary) {
    document.getElementById('selectedSignalTitle').textContent = 'No signal selected';
    document.getElementById('signalChart').innerHTML = '<div class="empty-state">Select one or more signals.</div>';
    return;
  }
  const mode = selectedSignals.length > 1 ? 'comparison' : 'single';
  document.getElementById('selectedSignalTitle').textContent = mode === 'comparison' ? `${selectedSignals.length} selected signals` : primary.signalName;
  document.getElementById('selectedSignalBadge').innerHTML = mode === 'comparison' ? renderStatusBadge('ok', 'Compare') : renderStatusBadge(primaryParameter?.status || 'no_rule', primaryParameter ? statusLabel(primaryParameter.status) : 'No Rule');
  document.getElementById('signalChart').innerHTML = mode === 'comparison' ? renderMultiSignalChart(visibleSignals) : renderSvgChart(primary, primaryParameter);
  document.getElementById('stateTimeline').innerHTML = renderTimelineBlock(result, primary);
  document.getElementById('signalMetrics').innerHTML = renderSelectionMetrics(selectedSignals, visibleSignals);
  document.getElementById('parameterSummary').innerHTML = mode === 'comparison' ? renderComparisonSummary(selectedSignals) : (primaryParameter ? renderParameter(primaryParameter) : `<div class="no-rule-box">${renderStatusBadge('no_rule')}<p>Signal is available for exploration but has no evaluation rule.</p><p>No operational severity is assigned.</p></div>`);
}

function matchesSignalFilter(signal, state) {
  if (state.query && !`${signal.signalName} ${signal.sourceName} ${signal.subsystem} ${signal.component} ${signal.deviceGroup}`.toLowerCase().includes(state.query.toLowerCase())) return false;
  if (state.source !== 'all' && signal.sourceName !== state.source) return false;
  if (state.coverage === 'rule' && !signal.hasRule) return false;
  if (state.coverage === 'no_rule' && signal.hasRule) return false;
  return true;
}

function renderSignalHierarchy(result, state, filteredIds) {
  const hierarchy = result.signalHierarchy?.length ? result.signalHierarchy : buildHierarchyFromCatalog(result.signalCatalog);
  const html = hierarchy.map(system => {
    const systemSignals = system.components.flatMap(component => component.signals).filter(signal => filteredIds.has(signal.signalId));
    if (!systemSignals.length) return '';
    const expanded = state.expandedSystems.has(system.systemId);
    return `<div class="nav-group"><button class="nav-row nav-system" data-system-toggle="${escapeAttribute(system.systemId)}"><span>${expanded ? '▾' : '▸'}</span><strong>${escapeHtml(system.systemName)}</strong><small>${systemSignals.length}</small><button class="text-button" data-select-system="${escapeAttribute(system.systemId)}">All</button></button>${expanded ? system.components.map(component => renderComponentNode(component, state, filteredIds)).join('') : ''}</div>`;
  }).join('');
  return html || '<p class="empty-state">No signals match the filters.</p>';
}

function renderComponentNode(component, state, filteredIds) {
  const signals = component.signals.filter(signal => filteredIds.has(signal.signalId));
  if (!signals.length) return '';
  const expanded = state.expandedComponents.has(component.componentId);
  return `<div class="nav-component"><button class="nav-row" data-component-toggle="${escapeAttribute(component.componentId)}"><span>${expanded ? '▾' : '▸'}</span><strong>${escapeHtml(component.componentName)}</strong><small>${signals.length}</small><button class="text-button" data-select-component="${escapeAttribute(component.componentId)}">All</button></button>${expanded ? signals.map(signal => `<label class="signal-item ${state.selectedIds.has(signal.signalId) ? 'active' : ''}"><input type="checkbox" data-signal-check="${escapeAttribute(signal.signalId)}" ${state.selectedIds.has(signal.signalId) ? 'checked' : ''}><button type="button" data-signal-id="${escapeAttribute(signal.signalId)}"><strong>${escapeHtml(signal.signalName)}</strong><small>${escapeHtml(signal.sourceName)}</small><span>${fmtNum(signal.latestValue)} ${escapeHtml(signal.unit || '')}</span>${renderStatusBadge(signal.status || (signal.hasRule ? 'ok' : 'no_rule'), signal.hasRule ? 'Rule' : 'No Rule')}</button></label>`).join('') : ''}</div>`;
}

function bindNavigatorEvents(result, state) {
  document.querySelectorAll('[data-system-toggle]').forEach(button => { button.onclick = event => { if (event.target.dataset.selectSystem) return; toggleSet(state.expandedSystems, button.dataset.systemToggle); renderSelection(result, state); }; });
  document.querySelectorAll('[data-component-toggle]').forEach(button => { button.onclick = event => { if (event.target.dataset.selectComponent) return; toggleSet(state.expandedComponents, button.dataset.componentToggle); renderSelection(result, state); }; });
  document.querySelectorAll('[data-signal-id]').forEach(button => { button.onclick = () => { state.selectedIds = new Set([button.dataset.signalId]); renderSelection(result, state); }; });
  document.querySelectorAll('[data-signal-check]').forEach(input => { input.onchange = () => { if (input.checked) state.selectedIds.add(input.dataset.signalCheck); else state.selectedIds.delete(input.dataset.signalCheck); renderSelection(result, state); }; });
  document.querySelectorAll('[data-select-component]').forEach(button => { button.onclick = event => { event.stopPropagation(); const component = findHierarchyComponent(result, button.dataset.selectComponent); for (const signal of component?.signals || []) state.selectedIds.add(signal.signalId); renderSelection(result, state); }; });
  document.querySelectorAll('[data-select-system]').forEach(button => { button.onclick = event => { event.stopPropagation(); const system = (result.signalHierarchy || []).find(item => item.systemId === button.dataset.selectSystem); for (const signal of system?.components.flatMap(component => component.signals) || []) state.selectedIds.add(signal.signalId); renderSelection(result, state); }; });
}

function toggleSet(set, value) { if (set.has(value)) set.delete(value); else set.add(value); }
function findHierarchyComponent(result, id) { return (result.signalHierarchy || []).flatMap(system => system.components || []).find(component => component.componentId === id); }

function renderSelectionMetrics(selectedSignals, visibleSignals) {
  const unitGroups = Array.from(new Set(selectedSignals.map(signal => signal.unit || 'unitless')));
  const warning = selectedSignals.length > 12 ? `<div class="metric warning"><label>Visible series limit</label><b>Showing 12 of ${selectedSignals.length}</b></div>` : '';
  const unitWarning = unitGroups.length > 2 ? `<div class="metric warning"><label>Unit safety</label><b>${unitGroups.length} unit groups; filter or split charts</b></div>` : '';
  return `${warning}${unitWarning}${summaryMetric('Selected', selectedSignals.length)}${summaryMetric('Visible series', visibleSignals.length)}${summaryMetric('Unit groups', unitGroups.join(', '))}${summaryMetric('Samples', selectedSignals.reduce((sum, signal) => sum + (signal.sampleCount || 0), 0))}`;
}

function renderComparisonSummary(signals) {
  const topVariable = [...signals].sort((a, b) => ((b.maximum ?? 0) - (b.minimum ?? 0)) - ((a.maximum ?? 0) - (a.minimum ?? 0))).slice(0, 8);
  const abnormal = signals.filter(signal => ['critical', 'warning', 'needs_validation', 'needs_configuration'].includes(signal.status)).slice(0, 8);
  return `<div class="comparison-summary"><h3>Whole selection summary</h3><p>Large selections are summarized first. Select individual signals to add them to the graph.</p><h4>Top abnormal signals</h4>${abnormal.map(signal => `<p>${renderStatusBadge(signal.status)} ${escapeHtml(signal.signalName)}</p>`).join('') || '<p>No abnormal selected signals.</p>'}<h4>Top variable signals</h4>${topVariable.map(signal => `<p>${escapeHtml(signal.signalName)} · range ${fmtNum((signal.maximum ?? 0) - (signal.minimum ?? 0))}</p>`).join('')}</div>`;
}

function renderTimelineBlock(result, signal) {
  const systemTimeline = result.systemStateTimelineBySystem?.[signal.subsystem] || result.systemStateTimelineBySystem?.[signal.component] || [];
  return `<div class="timeline-label">Machine State</div>${renderStateTimeline(result.machineStateTimeline || result.stateTimeline || [], result.metadata.selectedRange)}<div class="timeline-label">System State</div>${renderStateTimeline(systemTimeline, result.metadata.selectedRange)}`;
}

function renderMultiSignalChart(signals) {
  const series = signals.filter(signal => (signal.chartPoints || []).length);
  if (!series.length) return '<div class="empty-state">No chartable points.</div>';
  const unitGroups = Array.from(new Set(series.map(signal => signal.unit || 'unitless')));
  const allPoints = series.flatMap(signal => signal.chartPoints.map(point => ({ ...point, signal })));
  let minY = null; let maxY = null; let minT = null; let maxT = null;
  for (const point of allPoints) {
    if (Number.isFinite(point.actual)) {
      minY = minY === null ? point.actual : Math.min(minY, point.actual);
      maxY = maxY === null ? point.actual : Math.max(maxY, point.actual);
    }
    minT = minT === null ? point.t : Math.min(minT, point.t);
    maxT = maxT === null ? point.t : Math.max(maxT, point.t);
  }
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const x = t => 54 + ((t - minT) / Math.max(1, maxT - minT)) * 686;
  const y = v => 310 - ((v - minY) / Math.max(1, maxY - minY)) * 250;
  const colors = ['#39c7f3', '#43d17d', '#f4c542', '#ff8a4c', '#b38cff', '#ff5f68', '#7ee7d7', '#d6f35a', '#7aa7ff', '#f58bd1', '#a4c2f4', '#f6b26b'];
  const paths = series.map((signal, index) => {
    const path = signal.chartPoints.filter(point => Number.isFinite(point.actual)).map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.actual).toFixed(1)}`).join(' ');
    return `<path class="actual-line" style="stroke:${colors[index % colors.length]}" d="${path}"><title>${escapeHtml(signal.signalName)}</title></path>`;
  }).join('');
  const legend = series.map((signal, index) => `<span class="chart-legend-item" style="--c:${colors[index % colors.length]}"><b></b>${escapeHtml(signal.signalName)} · latest ${fmtNum(signal.latestValue)} · min ${fmtNum(signal.minimum)} · max ${fmtNum(signal.maximum)} · avg ${fmtNum(signal.average)}</span>`).join('');
  const unitWarning = unitGroups.length > 2 ? `<p class="warning-text">Warning: ${unitGroups.length} incompatible unit groups selected. Compare with filtering or stacked charts.</p>` : unitGroups.length === 2 ? '<p class="warning-text">Dual-unit comparison; verify scale before interpreting.</p>' : '';
  return `${unitWarning}<svg class="actual-expected-chart" viewBox="0 0 800 360" role="img"><line class="chart-axis" x1="54" x2="740" y1="310" y2="310"></line><line class="chart-axis" x1="54" x2="54" y1="40" y2="310"></line>${paths}<text x="54" y="24">Multi-signal comparison</text><text x="54" y="340">${fmtTime(minT)}</text><text x="560" y="340">${fmtTime(maxT)}</text></svg><div class="chart-legend">${legend}</div>`;
}

function buildHierarchyFromCatalog(signalCatalog = []) {
  const systems = new Map();
  for (const signal of signalCatalog) {
    const systemName = signal.subsystem || signal.system || 'Unclassified';
    const systemId = systemName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unclassified';
    const componentName = signal.deviceGroup || signal.component || 'Unclassified';
    const componentId = `${systemName}::${componentName}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!systems.has(systemId)) systems.set(systemId, { systemId, systemName, components: new Map() });
    const system = systems.get(systemId);
    if (!system.components.has(componentId)) system.components.set(componentId, { componentId, componentName, signals: [] });
    system.components.get(componentId).signals.push(signal);
  }
  return Array.from(systems.values()).map(system => ({ ...system, components: Array.from(system.components.values()) }));
}

function renderSvgChart(signal, parameter) {
  const points = signal.chartPoints || [];
  if (!points.length) return '<div class="empty-state">No chartable points.</div>';
  let minY = null; let maxY = null;
  for (const point of points) {
    for (const value of [point.actual, point.expected, point.allowedLow, point.allowedHigh]) {
      if (!Number.isFinite(value)) continue;
      minY = minY === null ? value : Math.min(minY, value);
      maxY = maxY === null ? value : Math.max(maxY, value);
    }
  }
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const minT = points[0].t;
  const maxT = points[points.length - 1].t || minT + 1;
  const x = t => 54 + ((t - minT) / Math.max(1, maxT - minT)) * 686;
  const y = v => 310 - ((v - minY) / Math.max(1, maxY - minY)) * 250;
  const path = points.filter(point => Number.isFinite(point.actual)).map((point, index) => `${index ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.actual).toFixed(1)}`).join(' ');
  const expected = points.filter(point => Number.isFinite(point.expected)).map((point, index) => `${index ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.expected).toFixed(1)}`).join(' ');
  const low = points.filter(point => Number.isFinite(point.allowedLow)).map((point, index) => `${index ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.allowedLow).toFixed(1)}`).join(' ');
  const high = points.filter(point => Number.isFinite(point.allowedHigh)).map((point, index) => `${index ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.allowedHigh).toFixed(1)}`).join(' ');
  const markers = points.filter(point => ['warning', 'critical'].includes(point.status)).slice(0, 80).map(point => `<circle class="chart-point ${statusClass(point.status)}" cx="${x(point.t).toFixed(1)}" cy="${y(point.actual).toFixed(1)}" r="3"><title>${fmtTime(point.t)} Actual ${fmtNum(point.actual)}</title></circle>`).join('');
  return `<svg class="actual-expected-chart" viewBox="0 0 800 360" role="img"><line class="chart-axis" x1="54" x2="740" y1="310" y2="310"></line><line class="chart-axis" x1="54" x2="54" y1="40" y2="310"></line>${high ? `<path class="allowed-line" d="${high}"></path>` : ''}${low ? `<path class="allowed-line" d="${low}"></path>` : ''}${expected ? `<path class="expected-value-line" d="${expected}"></path>` : ''}<path class="actual-line" d="${path}"></path>${markers}<text x="54" y="24">Actual${parameter ? ' / Expected / Allowed Range' : ''}</text><text x="54" y="340">${fmtTime(minT)}</text><text x="560" y="340">${fmtTime(maxT)}</text></svg>`;
}

function renderStateTimeline(timeline, range) {
  if (!timeline.length) return '<p class="tiny">No Machine State timeline available.</p>';
  const start = range.startTimestampMs;
  const span = Math.max(1, range.endTimestampMs - start);
  return timeline.map(item => `<span class="state-segment" style="left:${((item.startTimestampMs - start) / span * 100).toFixed(2)}%;width:${Math.max(0.5, item.durationMs / span * 100).toFixed(2)}%" title="${escapeHtml(item.state)} ${fmtDuration(item.durationMs)}">${escapeHtml(item.state)}</span>`).join('');
}

function renderParameter(parameter) {
  return `<div class="parameter-details ${statusClass(parameter.status)}">${renderStatusBadge(parameter.status)}<dl>
    ${detail('System / Component', `${parameter.system || '—'} / ${parameter.component || '—'}`)}${detail('Expected', fmtNum(parameter.currentExpected))}${detail('Allowed Range', `${fmtNum(parameter.currentAllowedLow)} – ${fmtNum(parameter.currentAllowedHigh)}`)}${detail('Difference', fmtNum(parameter.currentDifference))}${detail('Deviation', fmtNum(parameter.currentDeviation))}${detail('Time outside range', `${fmtDuration(parameter.totalOutOfRangeDurationMs)} (${fmtNum(parameter.outOfRangePercent)}%)`)}${detail('First / Last deviation', `${fmtTime(parameter.firstDeviationTimestampMs)} / ${fmtTime(parameter.lastDeviationTimestampMs)}`)}${detail('Reason', parameter.reason || '—')}${detail('Recommended action', parameter.recommendedAction || '—')}
  </dl></div>`;
}

function detail(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function renderSystemCard(system) {
  return `<article class="system-card ${statusClass(system.status)}">${renderStatusBadge(system.status)}<h3>${escapeHtml(system.systemName)}</h3><p>${system.evaluatedParameters}/${system.totalParameters} evaluated · ${system.criticalCount} critical · ${system.warningCount} warning</p><small>Worst: ${escapeHtml(system.worstParameterId || '—')}</small><button type="button">Open system</button></article>`;
}
