export const MACHINE_IMAGE_SRC = './assets/landa-machine.png';

export const APP_STAGES = [
  ['rules_loading', 'Rules', 5],
  ['archive_validation', 'Archive validation', 5],
  ['opc_indexing', 'opc indexing', 10],
  ['source_discovery', 'Source discovery', 5],
  ['machine_states', 'MachineStates', 15],
  ['source_parsing', 'Required log parsing', 40],
  ['evaluation', 'Evaluation', 10],
  ['timeline_finalization', 'Timeline/charts', 5],
  ['result_validation', 'Result validation', 5]
];

export const MAX_CHART_POINTS_PER_RULE = 2000;
export const MAX_EVIDENCE_PREVIEW_PER_RULE = 20;
export const MAX_EVIDENCE_SAMPLES_PER_RULE = 20;
export const MAX_INVALID_TIMESTAMP_EXAMPLES = 5;
export const MAX_DEVIATION_EVENTS_PER_RULE = 200;
export const MIN_DEVIATION_GAP_MS = 30000;

export const SYSTEMS = ['DPS', 'DFES', 'MSPS', 'ITS', 'IPS', 'Ventilation', 'ECS', 'IRD', 'QCS', 'BSS', 'STS', 'IPU', 'ICS', 'FEC', 'CWS', 'PSS', 'Dryer'];
export const MACHINE_STATE_SYSTEMS = ['Machine', 'BSS', 'IPS', 'PSS', 'Dryer', 'IPU', 'Ventilation', 'CWS', 'IRD', 'DFES', 'DPS', 'QCS', 'ICS', 'ECS', 'MSPS', 'ITS'];

export const SYSTEM_HOTSPOTS = {
  DPS: { anchorX: 13, anchorY: 61, labelX: 5, labelY: 40, side: 'left' },
  DFES: { anchorX: 18, anchorY: 45, labelX: 6, labelY: 24, side: 'left' },
  MSPS: { anchorX: 24, anchorY: 68, labelX: 10, labelY: 82, side: 'left' },
  ITS: { anchorX: 29, anchorY: 39, labelX: 22, labelY: 15, side: 'left' },
  IPS: { anchorX: 40, anchorY: 36, labelX: 36, labelY: 11, side: 'top' },
  ICS: { anchorX: 50, anchorY: 34, labelX: 50, labelY: 8, side: 'top' },
  Ventilation: { anchorX: 58, anchorY: 28, labelX: 64, labelY: 10, side: 'top' },
  ECS: { anchorX: 66, anchorY: 38, labelX: 75, labelY: 16, side: 'right' },
  IRD: { anchorX: 70, anchorY: 58, labelX: 79, labelY: 45, side: 'right' },
  QCS: { anchorX: 74, anchorY: 43, labelX: 86, labelY: 29, side: 'right' },
  BSS: { anchorX: 78, anchorY: 64, labelX: 88, labelY: 73, side: 'right' },
  STS: { anchorX: 84, anchorY: 49, labelX: 94, labelY: 54, side: 'right' },
  IPU: { anchorX: 89, anchorY: 65, labelX: 94, labelY: 83, side: 'right' },
  FEC: { anchorX: 93, anchorY: 52, labelX: 94, labelY: 36, side: 'right' },
  CWS: { anchorX: 34, anchorY: 70, labelX: 28, labelY: 88, side: 'bottom' },
  PSS: { anchorX: 55, anchorY: 72, labelX: 53, labelY: 91, side: 'bottom' },
  Dryer: { anchorX: 68, anchorY: 71, labelX: 70, labelY: 90, side: 'bottom' },
  LLCI: { anchorX: 46, anchorY: 58, labelX: 43, labelY: 78, side: 'bottom' }
};

export const REQUIRED_SOURCE_PATHS = {
  BSSNotifications: ['logs/LLCINotifications/BSS/'],
  IPSNotifications: ['logs/LLCINotifications/IPS/'],
  FECNotifications: ['logs/FECNotifications/'],
  MachineStates: ['logs/MachineStates/'],
  AlertsMonitoring: ['logs/AlertsMonitoring.txt', 'logs/AletrsMonitoring.txt']
};

export const SIGNAL_ALIASES = {
  fillflowmeteractualvalve: ['fillflowmeteractualvalue'],
  fillflowmeteractualvalue: ['fillflowmeteractualvalve'],
  waterflowmeteractualvalve: ['waterflowmeteractualvalue'],
  waterflowmeteractualvalue: ['waterflowmeteractualvalve']
};

export const STATUS_PRIORITY = {
  critical: 70,
  warning: 60,
  needs_validation: 50,
  needs_configuration: 45,
  evaluator_pending: 40,
  ok: 30,
  no_data: 20,
  no_rule: 10,
  not_analyzed: 0
};

export const STATUS_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  needs_validation: 'Needs validation',
  needs_configuration: 'Needs configuration',
  evaluator_pending: 'Evaluator pending',
  ok: 'OK',
  no_data: 'No data',
  no_rule: 'No rule',
  not_analyzed: 'Not analyzed'
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

export const SUPPORTED_CHECK_TYPES = new Set(['range', 'above threshold', 'below threshold', 'exact', 'max', 'min']);
export const PENDING_CHECK_TYPES = new Set(['delta', 'trend', 'flatline']);
