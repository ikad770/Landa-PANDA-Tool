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
export const MAX_DEVIATION_EVENTS_PER_RULE = 200;
export const MIN_DEVIATION_GAP_MS = 30000;

export const SYSTEMS = ['DPS', 'DFES', 'MSPS', 'ITS', 'IPS', 'Ventilation', 'ECS', 'IRD', 'QCS', 'BSS', 'STS', 'IPU', 'ICS', 'FEC', 'CWS', 'PSS', 'Dryer'];
export const MACHINE_STATE_SYSTEMS = ['Machine', 'BSS', 'IPS', 'PSS', 'Dryer', 'IPU', 'Ventilation', 'CWS', 'IRD', 'DFES', 'DPS', 'QCS', 'ICS', 'ECS', 'MSPS', 'ITS'];

export const SYSTEM_HOTSPOTS = {
  DPS: { x: 16, y: 57, labelX: 6, labelY: 40 },
  DFES: { x: 25, y: 36, labelX: 10, labelY: 20 },
  MSPS: { x: 32, y: 66, labelX: 17, labelY: 80 },
  ITS: { x: 37, y: 43, labelX: 30, labelY: 18 },
  IPS: { x: 45, y: 62, labelX: 42, labelY: 82 },
  Ventilation: { x: 48, y: 27, labelX: 43, labelY: 8 },
  ECS: { x: 55, y: 40, labelX: 57, labelY: 16 },
  IRD: { x: 61, y: 61, labelX: 61, labelY: 79 },
  QCS: { x: 66, y: 34, labelX: 70, labelY: 14 },
  BSS: { x: 73, y: 59, labelX: 76, labelY: 75 },
  STS: { x: 79, y: 41, labelX: 82, labelY: 23 },
  IPU: { x: 84, y: 63, labelX: 87, labelY: 80 },
  ICS: { x: 88, y: 31, labelX: 83, labelY: 8 },
  FEC: { x: 91, y: 50, labelX: 91, labelY: 34 },
  CWS: { x: 24, y: 72, labelX: 7, labelY: 70 },
  PSS: { x: 53, y: 74, labelX: 51, labelY: 90 },
  Dryer: { x: 67, y: 72, labelX: 70, labelY: 89 }
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
