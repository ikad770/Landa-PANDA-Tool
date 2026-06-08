import { normalizeSourceIdentity } from './config.js';
import { normalizeState, normalizeText, normalizeToken, parseNumber } from './evaluation.js';

const FIELD_ALIASES = {
  system: ['System'], subsystem: ['Subsystem'], component: ['Component'], signalName: ['Log Signal Name', 'Signal', 'Signal Name'], sourceName: ['Log Source', 'Source'],
  valueMetric: ['Value Metric'], checkType: ['Check Type'], genericExpected: ['Expected', 'Generic Expected'], specTolerance: ['Spec Tolerance'],
  warningLow: ['Warning Low'], warningHigh: ['Warning High'], criticalLow: ['Critical Low'], criticalHigh: ['Critical High'],
  warningDurationSec: ['Warning Duration Sec'], criticalDurationSec: ['Critical Duration Sec'], transitionGraceSec: ['Transition Grace Sec'],
  warningAction: ['Warning Action'], criticalAction: ['Critical Action'], outOfSpecAction: ['Out of Spec Action'], notes: ['Notes']
};
const STATE_FIELDS = ['ON', 'Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd', 'Recovery', 'Error'];

export function normalizeRuleRow(row, index = 0) {
  const get = aliases => {
    for (const alias of aliases) {
      if (row[alias] !== undefined) return row[alias];
      const found = Object.keys(row).find(key => normalizeToken(key) === normalizeToken(alias));
      if (found) return row[found];
    }
    return null;
  };
  const signalName = normalizeText(get(FIELD_ALIASES.signalName));
  const sourceName = normalizeText(get(FIELD_ALIASES.sourceName));
  const expectedByState = new Map();
  for (const state of STATE_FIELDS) {
    const value = parseNumber(get([`Expected ${state}`]));
    if (Number.isFinite(value)) expectedByState.set(normalizeState(state), value);
  }
  const rule = {
    parameterId: `param-${index + 1}`,
    ruleId: `rule-${index + 1}`,
    ruleRow: Number(row.__rowNum__ || row.ruleRow || index + 2),
    system: normalizeText(get(FIELD_ALIASES.system)) || 'Unassigned',
    subsystem: normalizeText(get(FIELD_ALIASES.subsystem)) || null,
    component: normalizeText(get(FIELD_ALIASES.component)) || null,
    signalName,
    normalizedSignal: normalizeToken(signalName),
    sourceName: sourceName || 'unknown',
    normalizedSource: normalizeSourceIdentity(sourceName),
    valueMetric: normalizeText(get(FIELD_ALIASES.valueMetric)) || null,
    checkType: normalizeText(get(FIELD_ALIASES.checkType)) || 'tolerance',
    genericExpected: parseNumber(get(FIELD_ALIASES.genericExpected)),
    expectedByState,
    hasStateSpecificExpected: expectedByState.size > 0,
    specTolerance: parseNumber(get(FIELD_ALIASES.specTolerance)),
    warningLow: parseNumber(get(FIELD_ALIASES.warningLow)),
    warningHigh: parseNumber(get(FIELD_ALIASES.warningHigh)),
    criticalLow: parseNumber(get(FIELD_ALIASES.criticalLow)),
    criticalHigh: parseNumber(get(FIELD_ALIASES.criticalHigh)),
    warningDurationSec: parseNumber(get(FIELD_ALIASES.warningDurationSec)),
    criticalDurationSec: parseNumber(get(FIELD_ALIASES.criticalDurationSec)),
    transitionGraceSec: parseNumber(get(FIELD_ALIASES.transitionGraceSec)),
    warningAction: normalizeText(get(FIELD_ALIASES.warningAction)) || null,
    criticalAction: normalizeText(get(FIELD_ALIASES.criticalAction)) || null,
    outOfSpecAction: normalizeText(get(FIELD_ALIASES.outOfSpecAction)) || null,
    notes: normalizeText(get(FIELD_ALIASES.notes)) || null
  };
  rule.validity = signalName ? 'valid' : 'invalid';
  rule.invalidReason = signalName ? '' : 'missing_signal_name';
  return rule;
}

export function normalizeRulesRows(rows = []) {
  return rows.map((row, index) => normalizeRuleRow(row, index)).filter(rule => rule.validity === 'valid');
}

export function parseRulesWorkbook(XLSX, arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find(name => /rule|panda/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return normalizeRulesRows(rows);
}

export function buildRulesIndex(rules) {
  const exact = new Map();
  const bySignal = new Map();
  for (const rule of rules) {
    const key = `${rule.normalizedSource}::${rule.normalizedSignal}`;
    exact.set(key, rule);
    if (!bySignal.has(rule.normalizedSignal)) bySignal.set(rule.normalizedSignal, []);
    bySignal.get(rule.normalizedSignal).push(rule);
  }
  return { exact, bySignal };
}

export function findRuleForStream(index, stream) {
  return index.exact.get(`${stream.sourceId}::${stream.normalizedSignal}`) || index.bySignal.get(stream.normalizedSignal)?.[0] || null;
}
