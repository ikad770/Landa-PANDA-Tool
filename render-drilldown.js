import { escapeHtml, fmtNum, fmtTime, renderStatusBadge } from './render.js';

export function sortComparisonRows(rows = []) {
  return [...rows].sort((a, b) => String(a.system || '').localeCompare(String(b.system || '')) || String(a.signalName || a.signal || '').localeCompare(String(b.signalName || b.signal || '')));
}

export function renderDrilldown(app) {
  const root = document.getElementById('drilldownRoot');
  if (!root) return;
  const result = app.analysisResult;
  if (!result?.parameterSummaries) {
    root.innerHTML = '<section class="panel pad">No V2 result loaded.</section>';
    return;
  }
  const rows = sortComparisonRows(result.parameterSummaries.filter(parameter => !app.selectedSystem || parameter.system === app.selectedSystem));
  root.innerHTML = `<section class="panel pad"><h2>${escapeHtml(app.selectedSystem || 'All systems')}</h2><div class="compact-list">${rows.map(renderParameterRow).join('') || '<p>No configured parameters for this system.</p>'}</div></section>`;
}

function renderParameterRow(parameter) {
  return `<article class="finding-item"><span>${renderStatusBadge(parameter.status)}</span><strong>${escapeHtml(parameter.signalName || 'Signal')}</strong><small>${escapeHtml(parameter.sourceName || '')} · Actual ${fmtNum(parameter.latestActual)} · Expected ${fmtNum(parameter.currentExpected)} · Last ${fmtTime(parameter.latestTimestampMs)}</small></article>`;
}
