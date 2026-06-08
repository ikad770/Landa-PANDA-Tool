import { STATUS_PRIORITY } from './config.js';
import { escapeHtml, fmtDuration, fmtNum, fmtTime, renderStatusBadge, statusClass, statusLabel } from './render.js';

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
  const state = { query: '', source: 'all', coverage: 'all', selectedId: result.signalCatalog[0]?.signalId || null };
  const sources = Array.from(new Set(result.signalCatalog.map(signal => signal.sourceName))).sort();
  root.innerHTML = `${renderTopSummary(result)}
  <section class="results-grid">
    <aside class="panel signal-explorer"><div class="panel-title"><h2>Signal Explorer</h2></div>
      <input id="signalSearch" class="search-input" placeholder="Search signals">
      <select id="sourceFilter"><option value="all">All sources</option>${sources.map(source => `<option>${escapeHtml(source)}</option>`).join('')}</select>
      <select id="coverageFilter"><option value="all">All coverage</option><option value="rule">Rule</option><option value="no_rule">No Rule</option></select>
      <div id="signalList" class="signal-list"></div>
    </aside>
    <main class="panel trend-panel"><div class="panel-title"><h2 id="selectedSignalTitle">Selected signal</h2><span id="selectedSignalBadge"></span></div><div id="signalChart"></div><div id="stateTimeline" class="state-timeline"></div><div id="signalMetrics" class="metric-grid"></div></main>
    <aside class="panel analysis-summary"><div class="panel-title"><h2>Analysis Summary</h2></div><div id="parameterSummary"></div></aside>
  </section>
  <section class="panel system-overview"><div class="panel-title"><h2>Basic System Overview</h2></div><div class="system-card-grid">${result.systems.map(renderSystemCard).join('')}</div></section>`;
  const render = () => renderSelection(result, state);
  document.getElementById('signalSearch').oninput = event => { state.query = event.target.value; render(); };
  document.getElementById('sourceFilter').onchange = event => { state.source = event.target.value; render(); };
  document.getElementById('coverageFilter').onchange = event => { state.coverage = event.target.value; render(); };
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
  const filtered = result.signalCatalog.filter(signal => {
    if (state.query && !`${signal.signalName} ${signal.sourceName}`.toLowerCase().includes(state.query.toLowerCase())) return false;
    if (state.source !== 'all' && signal.sourceName !== state.source) return false;
    if (state.coverage === 'rule' && !signal.hasRule) return false;
    if (state.coverage === 'no_rule' && signal.hasRule) return false;
    return true;
  });
  if (!filtered.find(signal => signal.signalId === state.selectedId)) state.selectedId = filtered[0]?.signalId || result.signalCatalog[0]?.signalId || null;
  document.getElementById('signalList').innerHTML = filtered.map(signal => `<button class="signal-item ${signal.signalId === state.selectedId ? 'active' : ''}" data-signal-id="${signal.signalId}"><strong>${escapeHtml(signal.signalName)}</strong><small>${escapeHtml(signal.sourceName)}</small><span>${fmtNum(signal.latestValue)} ${escapeHtml(signal.unit || '')}</span>${renderStatusBadge(signal.hasRule ? 'ok' : 'no_rule', signal.hasRule ? 'Rule' : 'No Rule')}</button>`).join('') || '<p class="empty-state">No signals match the filters.</p>';
  document.querySelectorAll('[data-signal-id]').forEach(button => { button.onclick = () => { state.selectedId = button.dataset.signalId; renderSelection(result, state); }; });
  const signal = result.signalCatalog.find(item => item.signalId === state.selectedId);
  const parameter = result.parameterSummaries.find(item => item.signalId === state.selectedId);
  if (!signal) return;
  document.getElementById('selectedSignalTitle').textContent = signal.signalName;
  document.getElementById('selectedSignalBadge').innerHTML = renderStatusBadge(parameter?.status || 'no_rule', parameter ? statusLabel(parameter.status) : 'No Rule');
  document.getElementById('signalChart').innerHTML = renderSvgChart(signal, parameter);
  document.getElementById('stateTimeline').innerHTML = renderStateTimeline(result.stateTimeline, result.metadata.selectedRange);
  document.getElementById('signalMetrics').innerHTML = [
    ['Latest', `${fmtNum(signal.latestValue)} ${signal.unit || ''}`], ['Average', fmtNum(signal.average)], ['Minimum', fmtNum(signal.minimum)], ['Maximum', fmtNum(signal.maximum)], ['Samples', signal.sampleCount], ['First', fmtTime(signal.firstTimestampMs)], ['Last', fmtTime(signal.lastTimestampMs)], ['Chart points', `${signal.renderedPointCount} / ${signal.rawPointCount}`]
  ].map(([label, value]) => summaryMetric(label, value)).join('');
  document.getElementById('parameterSummary').innerHTML = parameter ? renderParameter(parameter) : `<div class="no-rule-box">${renderStatusBadge('no_rule')}<p>Signal is available for exploration but has no evaluation rule.</p><p>No operational severity is assigned.</p></div>`;
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
