export const APP_STAGES = [
  ['rules_loading', 'Rules loading', 5],
  ['archive_validation', 'Archive validation', 5],
  ['opc_indexing', 'opc.zip indexing', 10],
  ['source_discovery', 'Source discovery', 5],
  ['machine_states', 'MachineStates parsing', 15],
  ['source_parsing', 'Relevant source parsing', 40],
  ['evaluation', 'Rule evaluation and deviation aggregation', 10],
  ['timeline_finalization', 'Timeline/chart finalization', 5],
  ['dashboard_finalization', 'Dashboard model finalization', 5]
];

export const STAGE_WEIGHTS = Object.fromEntries(APP_STAGES.map(([key, , weight]) => [key, weight]));

export const MAX_CSV_TEXT_MB_WARNING = 150;
export const MAX_CHART_POINTS_PER_RULE = 2000;
export const MAX_EVIDENCE_PREVIEW_PER_RULE = 20;
export const MAX_DEVIATION_EVENTS_PER_RULE = 200;
export const MAX_DIAGNOSTIC_RAW_LINES = 20;
export const MIN_DEVIATION_GAP_MS = 30_000;

export const STATUS_PRIORITY = {
  critical: 6,
  warning: 5,
  needs_validation: 4,
  evaluator_pending: 3,
  ok: 2,
  no_data: 1,
  no_rule: 0
};

export const STATUS_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  needs_validation: 'Needs validation',
  evaluator_pending: 'Evaluator pending',
  ok: 'OK',
  no_data: 'No data',
  no_rule: 'No rule'
};

export const SYSTEM_HOTSPOTS = {
  DPS: { x: 22, y: 51, labelX: 8, labelY: 35 },
  DFES: { x: 34, y: 36, labelX: 23, labelY: 18 },
  BSS: { x: 46, y: 63, labelX: 36, labelY: 76 },
  IPS: { x: 58, y: 43, labelX: 62, labelY: 23 },
  FEC: { x: 72, y: 52, labelX: 75, labelY: 36 },
  LLCI: { x: 41, y: 49, labelX: 28, labelY: 56 },
  DFE: { x: 64, y: 33, labelX: 69, labelY: 16 },
  MACHINE: { x: 50, y: 20, labelX: 43, labelY: 8 }
};

export const EXPECTED_STATE_COLUMNS = {
  on: 'Expected ON',
  standby: 'Expected Standby',
  ready: 'Expected Ready',
  prepare2print: 'Expected Prepare2Print',
  printing: 'Expected Printing',
  printend: 'Expected PrintEnd',
  recovery: 'Expected Recovery',
  error: 'Expected Error'
};

export const SUPPORTED_CHECK_TYPES = new Set(['range', 'above threshold', 'below threshold', 'exact']);
export const PENDING_CHECK_TYPES = new Set(['delta', 'trend', 'flatline', 'statedependent', 'state dependent']);
