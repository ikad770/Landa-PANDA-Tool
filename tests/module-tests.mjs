import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { authenticateLocalPrototype, validateLoginFields } from '../auth.js';
import { AUTH_CONFIG, MAX_CHART_POINTS_PER_SIGNAL, USER_FACING_STAGES, normalizeSourceIdentity } from '../config.js';
import { detectLogSchema, inferFecSignal, normalizeSourceRow, parseDelimitedText, parseFlexibleTimestamp } from '../adapters.js';
import { appendRows, parseTextLogsToRows } from '../parsing-utils.js';
import { buildRulesIndex, findRuleDiagnostics, normalizeRulesRows } from '../rules.js';
import { comparePoint, computeAllowedRange, normalizeState, normalizeToken, parseNumber, resolveExpected } from '../evaluation.js';
import { createStateTimeline, createSystemStateTimelines } from '../machine-states.js';
import { assertV2Invariants, createChartSampler, runV2Pipeline } from '../v2-pipeline.js';

function walk(value, visitor, path = 'result', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  assert.equal(seen.has(value), false, `${path} has no cycles`);
  seen.add(value);
  visitor(value, path);
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  for (const [key, child] of entries) walk(child, visitor, `${path}.${key}`, seen);
}

function makeRules() {
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    rows.push({
      System: i < 6 ? 'IPS' : 'BSS',
      Subsystem: `Subsystem ${i % 3}`,
      Component: `Component ${i}`,
      'Log Signal Name': `Configured Signal ${i}`,
      'Log Source': i % 2 ? 'source-b' : 'source-a',
      'Value Metric': 'Average',
      'Check Type': 'Tolerance',
      'Expected Printing': 100 + i,
      'Expected Standby': 90 + i,
      'Spec Tolerance': i === 10 ? '' : 5,
      'Warning Low': '',
      'Warning High': '',
      'Critical Low': i === 2 ? 80 : '',
      'Critical High': i === 2 ? 130 : '',
      'Warning Duration Sec': 10,
      'Critical Duration Sec': i === 2 ? 5 : '',
      'Transition Grace Sec': 2,
      'Warning Action': `Review configured signal ${i}`,
      'Critical Action': i === 2 ? 'Stop and inspect explicit critical breach' : '',
      'Out of Spec Action': 'Inspect parameter',
      Notes: i === 10 ? 'Incomplete tolerance rule' : ''
    });
  }
  rows.push({ System: 'IPS', 'Log Signal Name': 'Missing Data Rule', 'Log Source': 'source-a', 'Expected Printing': 50, 'Spec Tolerance': 5 });
  return normalizeRulesRows(rows);
}

function makeRows(totalPoints = 100_800) {
  const rows = [];
  const states = ['ON', 'Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd', 'Recovery', 'Error'];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const signals = [];
  for (let i = 0; i < 12; i += 1) signals.push({ name: `Configured Signal ${i}`, source: i % 2 ? 'source-b' : 'source-a' });
  for (let i = 0; i < 18; i += 1) signals.push({ name: `Explorer Only Signal ${i}`, source: i % 2 ? 'source-b' : 'source-c' });
  let n = 0;
  while (n < totalPoints) {
    for (let s = 0; s < signals.length && n < totalPoints; s += 1) {
      const signal = signals[s];
      const timestampMs = start + n * 1000;
      const machineState = states[Math.floor(n / 1500) % states.length];
      let numericValue = signal.name.startsWith('Configured') ? 100 + Number(signal.name.split(' ').at(-1)) : 20 + s;
      if (signal.name === 'Configured Signal 1' && n % 6000 > 4000) numericValue += 9;
      if (signal.name === 'Configured Signal 2' && n % 9000 > 7000) numericValue += 40;
      if (signal.name === 'Configured Signal 10') numericValue += 2;
      rows.push({
        sourceId: normalizeSourceIdentity(signal.source),
        sourceName: signal.source,
        signalName: signal.name,
        normalizedSignal: normalizeToken(signal.name),
        timestampMs,
        numericValue,
        unit: 'u',
        rawState: machineState,
        machineState,
        systemState: machineState
      });
      n += 1;
    }
  }
  return rows;
}

// Level 1 — parsing and normalization.
assert.equal(parseNumber('42.5'), 42.5);
assert.equal(parseNumber('42,5'), 42.5);
assert.equal(parseNumber('1,234.5'), 1234.5);
assert.equal(parseNumber('0'), 0);
assert.equal(normalizeToken(' Tank Actual Level MM '), 'tank_actual_level_mm');
assert.equal(normalizeSourceIdentity('logs/LLCINotifications/BSS/file.csv'), 'bss/file');
assert.equal(normalizeState('prepare to print'), 'Prepare2Print');
assert.equal(new Date(parseFlexibleTimestamp('2026-01-01T00:00:00Z')).getUTCFullYear(), 2026);
const parsedRows = parseDelimitedText('Timestamp,Signal,Value,Unit,Machine State,Source\n2026-01-01T00:00:00Z,Pressure,0,bar,Printing,source-a');
assert.equal(parsedRows[0].numericValue, 0);
assert.equal(parsedRows[0].machineState, 'Printing');
assert.equal(normalizeSourceRow({ Timestamp: '2026-01-01T00:00:00Z', Signal: 'Temp', Value: '25.2', Source: 'source-a' }).normalizedSignal, 'temp');
const partialRule = normalizeRulesRows([{ System: 'IPS', 'Log Signal Name': 'Temp', 'Log Source': 'source-a', 'Expected Printing': 0 }])[0];
assert.equal(partialRule.expectedByState.get('Printing'), 0, 'numeric zero remains configured');


// Real schema adapters — BSS, FEC, MachineStates.
const bssCsv = `Timestamp,Action,MessageType,LLCIKey,MachineType,Component,SubComponent,ParameterType,Value,IsAlert
05/07/2026 16:19:44:544139,Get,Parameter,3149317,CommonMachine,BCUInputsOutputs,FillActualTemperatureC,Float,34.5,False
05/07/2026 16:19:45:544139,Get,Parameter,3149318,CommonMachine,BCUInputsOutputs,Enabled,Bool,False,False
05/07/2026 16:19:46:544139,StateMachine,,3149319,CommonMachine,States,,Prepare2Print,,False
05/07/2026 16:19:47:544139,SubsystemState,,3149320,CommonMachine,States,BCS_State,String,Ready,False`;
assert.equal(detectLogSchema(bssCsv.split('\n')[0].split(','), 'BSS.csv'), 'bss_notification');
const bssRows = parseDelimitedText(bssCsv, 'BSS Notifications.csv');
const bssSignal = bssRows.find(row => row.signalName === 'FillActualTemperatureC');
assert.equal(bssSignal.component, 'BCUInputsOutputs');
assert.equal(bssSignal.subsystem, 'BSS');
assert.equal(bssSignal.numericValue, 34.5);
assert.equal(bssRows.some(row => row.signalName === 'Enabled' && row.kind === 'sample'), false, 'Boolean BSS parameters are not numeric trend samples');
assert.equal(bssRows.find(row => row.scope === 'machine').machineState, 'Prepare2Print');
assert.equal(bssRows.find(row => row.scope === 'system').systemState, 'Ready');

const fecCsv = `Timestamp,Type,CableId,PSSID,SetPoint,Enabled,HasErrors,HasWarnings,PSCState,Status,State
05/07/2026 16:34:49:702291,DeviceStatus,260,IPU1 Pressure(12345),73.25459,False,False,False,Off,0,
05/07/2026 16:34:50:702291,ControlStatus,261,DRY2 PWM(28557),55,True,False,False,On,0,
05/07/2026 16:34:51:702291,DeviceStatus,262,Ch6PeakCurrent(28558),10,True,False,False,On,0,
05/07/2026 16:34:52:702291,StateMachine,,IPU,,False,False,False,,0,Prepare2Print`;
assert.equal(detectLogSchema(fecCsv.split('\n')[0].split(','), 'FEC.csv'), 'fec_notification');
const fecRows = parseDelimitedText(fecCsv, 'FEC Notifications.csv');
const ipuPressure = fecRows.find(row => row.signalName === 'IPU1 Pressure');
assert.equal(ipuPressure.metadata.signalNumericId, '12345');
assert.equal(ipuPressure.numericValue, 73.25459);
assert.equal(ipuPressure.metadata.deviceInstance, '260');
assert.equal(ipuPressure.subsystem, 'IPU');
assert.equal(ipuPressure.deviceGroup, 'IPU1');
assert.equal(fecRows.find(row => row.signalName === 'DRY2 PWM').subsystem, 'Dryer / IRD');
assert.equal(fecRows.find(row => row.signalName === 'Ch6PeakCurrent').deviceGroup, 'DRY6');
assert.equal(fecRows.find(row => row.scope === 'system').systemState, 'Prepare2Print');
assert.equal(fecRows.some(row => new RegExp(['Spitfire', 'Server', 'Modules'].join('\\.')).test(row.signalName || '')), false);
assert.deepEqual(inferFecSignal('WaterInTemp'), { subsystem: 'CWS', component: 'CWS', deviceGroup: 'CWS' });

const msCsv = `Time,Machine,BSS,IPS,PSS,Dryer,IPU,Ventilation,CWS,IRD,DFES,DPS,QCS,ICS,ECS,MSPS,ITS
07/05/2026 08:29:35.474�,Ready,---,---,---,Standby,---,---,---,---,---,---,---,---,---,---,---
07/05/2026 08:29:36.474,---,On,---,---,Standby,Prepare2Print,---,---,---,---,---,---,---,---,---,---
07/05/2026 08:29:37.474,Printing,---,---,---,Standby,---,---,---,---,---,---,---,---,---,---,---
07/05/2026 08:29:38.474,---,---,---,---,Printing,---,---,---,---,---,---,---,---,---,---,---`;
assert.equal(detectLogSchema(msCsv.split('\n')[0].split(','), 'MachineStates.csv'), 'machine_states');
const msRows = parseDelimitedText(msCsv, 'MachineStates.csv');
assert.equal(msRows.filter(row => row.scope === 'machine').length, 2);
const msRange = { startTimestampMs: parseFlexibleTimestamp('07/05/2026 08:29:35.474'), endTimestampMs: parseFlexibleTimestamp('07/05/2026 08:29:39.474') };
const machineIntervals = createStateTimeline(msRows.filter(row => row.scope === 'machine'), msRange);
assert.equal(machineIntervals[0].state, 'Ready');
assert.equal(machineIntervals[1].state, 'Printing');
const systemIntervals = createSystemStateTimelines(msRows.filter(row => row.scope === 'system'), msRange);
assert.equal(systemIntervals.Dryer.length, 2, 'adjacent equal Dryer sparse updates merge before changed state');
assert.equal(systemIntervals.IPU[0].state, 'Prepare2Print');
assert.ok(parseFlexibleTimestamp('05/07/2026 16:19:44:544139') < parseFlexibleTimestamp('05/07/2026 16:34:49:702291'));
assert.equal(new Date(parseFlexibleTimestamp('07/05/2026 08:29:35.474')).getMonth(), 4, 'DD/MM/YYYY month is May');

const realRules = normalizeRulesRows([
  { System: 'BSS', 'Log Source': 'BSS', 'Log Signal Name': 'FillActualTemperatureC', 'Expected Ready': 35, 'Spec Tolerance': 5 },
  { System: 'IPU', 'Log Source': 'FEC', 'Log Signal Name': 'IPU1 Pressure', 'Expected Prepare2Print': 73, 'Spec Tolerance': 3 },
  { System: 'IPU', 'Log Source': 'FEC', 'Log Signal Name': 'IPU1 Pressure', 'Expected Ready': 73, 'Spec Tolerance': 3 }
]);
const realIndex = buildRulesIndex(realRules);
assert.equal(findRuleDiagnostics(realIndex, { sourceId: 'bss', sourceType: 'bss_notification', sourceName: 'BSS Notifications.csv', subsystem: 'BSS', normalizedSignal: normalizeToken('FillActualTemperatureC') }).status, 'exact_match');
assert.equal(findRuleDiagnostics(realIndex, { sourceId: 'fec', sourceType: 'fec_notification', sourceName: 'FEC Notifications.csv', subsystem: 'IPU', normalizedSignal: normalizeToken('IPU1 Pressure') }).status, 'duplicate_rules');

const appendRegressionRowCount = 150_000;
const appendRegressionText = `Timestamp,Signal,Value,Unit,Machine State,Source
${Array.from({ length: appendRegressionRowCount }, (_, i) => `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z,Pressure,${i},bar,Printing,source-a`).join('\n')}`;
const appendRegressionParsedRows = parseDelimitedText(appendRegressionText, 'append-regression.csv');
assert.equal(appendRegressionParsedRows.length, appendRegressionRowCount);
const appendedRows = [];
assert.doesNotThrow(() => appendRows(appendedRows, appendRegressionParsedRows), 'appendRows must not spread parsed rows as call arguments');
assert.equal(appendedRows.length, appendRegressionRowCount);

const largeParseLogs = Array.from({ length: 3 }, (_, fileIndex) => ({
  name: `large-generated-${fileIndex + 1}.csv`,
  text: `Timestamp,Signal,Value,Unit,Machine State,Source
${Array.from({ length: 50_000 }, (_, rowIndex) => {
    const absoluteIndex = fileIndex * 50_000 + rowIndex;
    return `2026-01-01T00:${String(Math.floor(rowIndex / 60) % 60).padStart(2, '0')}:${String(rowIndex % 60).padStart(2, '0')}Z,Configured Signal ${absoluteIndex % 2},${100 + (absoluteIndex % 10)},u,Printing,source-a`;
  }).join('\n')}`
}));
const parseStageEvents = [];
const largeParsedRows = parseTextLogsToRows(largeParseLogs, (processed, total, name, rowCount) => parseStageEvents.push({ stage: 'parse', processed, total, name, rowCount }));
assert.equal(largeParsedRows.length, 150_000);
assert.equal(parseStageEvents.length, largeParseLogs.length);
const parseIndexProgressEvents = [];
const parseIndexResult = runV2Pipeline({
  rows: largeParsedRows,
  rules: normalizeRulesRows([{ System: 'IPS', 'Log Signal Name': 'Configured Signal 0', 'Log Source': 'source-a', 'Expected Printing': 100, 'Spec Tolerance': 5 }]),
  inputFiles: largeParseLogs.map(log => ({ name: log.name })),
  startedMs: Date.now(),
  progress: (stage, fraction, message, processed, total) => parseIndexProgressEvents.push({ stage, fraction, message, processed, total })
});
assert.equal(parseIndexResult.metadata.rowsProcessed, largeParsedRows.length);
assert.ok(parseIndexProgressEvents.some(event => event.stage === 'index'), 'parse-stage integration reaches Index stage');

// Level 2 — signal discovery and chart sampling.
const sampler = createChartSampler(50);
for (let i = 0; i < 1000; i += 1) sampler.add({ timestampMs: i, actual: Math.sin(i / 10), status: i === 500 ? 'warning' : 'ok', machineState: i < 500 ? 'Printing' : 'Standby' });
const sampled = sampler.finish();
assert.ok(sampled.chartPoints.length <= 50);
assert.equal(sampled.rawPointCount, 1000);
assert.ok(sampled.chartPoints.some(point => point.status === 'warning'));
assert.ok(sampled.downsampled);

// Level 3 — evaluation.
const evalRule = normalizeRulesRows([{ System: 'IPS', 'Log Signal Name': 'Pressure', 'Log Source': 'source-a', 'Expected Printing': 25, 'Spec Tolerance': 2, 'Critical High': 32, 'Warning Action': 'Review', 'Critical Action': 'Stop' }])[0];
assert.equal(resolveExpected(evalRule, 'Printing', null).expected, 25);
assert.deepEqual(computeAllowedRange(evalRule, 25), { valid: true, low: 23, high: 27, reasonCode: '' });
const ok = comparePoint(evalRule, { numericValue: 26, machineState: 'Printing' }, { machineState: 'Printing', status: 'matched' });
assert.equal(ok.status, 'ok');
const warning = comparePoint(evalRule, { numericValue: 29.2, machineState: 'Printing' }, { machineState: 'Printing', status: 'matched' });
assert.equal(warning.status, 'warning');
assert.equal(Number(warning.difference.toFixed(1)), 4.2);
assert.equal(Number(warning.deviation.toFixed(1)), 2.2);
const critical = comparePoint(evalRule, { numericValue: 33, machineState: 'Printing' }, { machineState: 'Printing', status: 'matched' });
assert.equal(critical.status, 'critical');
const needsConfig = comparePoint(normalizeRulesRows([{ System: 'IPS', 'Log Signal Name': 'Pressure', 'Log Source': 'source-a', 'Spec Tolerance': 2 }])[0], { numericValue: 33 }, { machineState: 'Printing', status: 'matched' });
assert.equal(needsConfig.status, 'needs_configuration');
const needsValidation = comparePoint(evalRule, { numericValue: 33 }, { status: 'too_old' });
assert.equal(needsValidation.status, 'needs_validation');
const timeline = createStateTimeline([{ timestampMs: 0, machineState: 'Printing' }, { timestampMs: 10, machineState: 'Printing' }, { timestampMs: 20, machineState: 'Standby' }], { startTimestampMs: 0, endTimestampMs: 30 });
assert.equal(timeline.length, 2);
assert.equal(timeline[0].durationMs, 20);

// Level 4 — full V2 pipeline stress.
const rules = makeRules();
const rows = makeRows();
const progressEvents = [];
const t0 = performance.now();
const result = runV2Pipeline({ rows, rules, inputFiles: [{ name: 'generated-autocollect.zip' }, { name: 'generated-rules.xlsx' }], startedMs: Date.now(), progress: (stage, fraction, message, processed, total) => progressEvents.push({ stage, fraction, message, processed, total }) });
const runtimeDuration = performance.now() - t0;
assert.equal(result.schemaVersion, '2.0');
assert.equal(result.summary.configuredSignals, 13);
assert.equal(result.summary.discoveredSignals, 30);
assert.ok(Array.isArray(result.signalHierarchy));
assert.ok(result.signalHierarchy.some(system => system.components?.length));
assert.equal(result.metadata.rowsProcessed, rows.length);
assert.ok(result.summary.noRuleSignals >= 18);
assert.ok(result.summary.noDataRules >= 1);
assert.ok(result.summary.warningParameters >= 1);
assert.ok(result.summary.criticalParameters >= 1);
assert.ok(result.summary.configurationIssues >= 1);
assertV2Invariants(result);
for (const signal of result.signalCatalog) assert.ok(signal.chartPoints.length <= MAX_CHART_POINTS_PER_SIGNAL);
const configured0 = result.signalCatalog.find(signal => signal.signalName === 'Configured Signal 0');
assert.equal(configured0.sampleCount, rows.filter(row => row.signalName === 'Configured Signal 0').length, 'metrics use all points');
assert.ok(configured0.renderedPointCount < configured0.rawPointCount, 'charts are bounded independently from metrics');
const paramIds = new Set(result.parameterSummaries.map(parameter => parameter.parameterId));
assert.equal(paramIds.size, result.parameterSummaries.length, 'parameter finalized once');
assert.doesNotThrow(() => JSON.stringify(result));
if (typeof structuredClone === 'function') assert.doesNotThrow(() => structuredClone(result));
walk(result, (node, path) => {
  assert.equal('rawRows' in node, false, `${path} has no rawRows`);
  assert.equal('normalizedRows' in node, false, `${path} has no normalizedRows`);
  assert.equal('activeDeviation' in node, false, `${path} has no runtime accumulator`);
  assert.equal('sampler' in node, false, `${path} has no sampler`);
  assert.equal('points' in node, false, `${path} has no raw point bucket`);
});
assert.equal(result.parameterSummaries.some(parameter => 'chartPoints' in parameter), false, 'chart series is serialized only in signalCatalog');
for (const system of result.systems) {
  assert.equal('parameters' in system, false);
  assert.equal('chartPoints' in system, false);
}
assert.ok(result.diagnostics.recentEntries.length <= 250);
const orderedStages = ['index', 'analyze', 'finalize'];
assert.deepEqual([...new Set(progressEvents.map(event => event.stage))].filter(stage => orderedStages.includes(stage)), orderedStages);
const payloadBytes = Buffer.byteLength(JSON.stringify(result));
const retainedChartPoints = result.signalCatalog.reduce((sum, signal) => sum + signal.chartPoints.length, 0);
assert.ok(payloadBytes < 8_000_000, `payload bytes bounded: ${payloadBytes}`);
console.log(JSON.stringify({ rules: rules.length, signals: result.summary.discoveredSignals, totalPoints: rows.length, retainedChartPoints, payloadBytes, runtimeDurationMs: Math.round(runtimeDuration) }));

// Existing login basics and stage contract remain correct.
assert.equal(validateLoginFields({ username: '', password: '' }).valid, false);
assert.equal(authenticateLocalPrototype({ username: AUTH_CONFIG.username, password: AUTH_CONFIG.password }).ok, true);
assert.equal(USER_FACING_STAGES.map(stage => stage.key).join(','), 'upload,parse,index,analyze,finalize');
