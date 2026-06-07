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
  DPS: { anchorX: 14, anchorY: 60, labelX: 6, labelY: 39, labelAlign: 'left', region: 'front_cockpit' },
  DFES: { anchorX: 18, anchorY: 45, labelX: 7, labelY: 24, labelAlign: 'left', region: 'front_cockpit' },
  MSPS: { anchorX: 23, anchorY: 68, labelX: 10, labelY: 82, labelAlign: 'left', region: 'front_cockpit' },
  ITS: { anchorX: 28, anchorY: 39, labelX: 22, labelY: 14, labelAlign: 'center', region: 'front_cockpit' },
  IPS: { anchorX: 39, anchorY: 38, labelX: 35, labelY: 10, labelAlign: 'center', region: 'central_print_engine' },
  ICS: { anchorX: 49, anchorY: 35, labelX: 49, labelY: 8, labelAlign: 'center', region: 'central_print_engine' },
  Ventilation: { anchorX: 58, anchorY: 30, labelX: 63, labelY: 10, labelAlign: 'center', region: 'central_print_engine' },
  ECS: { anchorX: 66, anchorY: 39, labelX: 74, labelY: 16, labelAlign: 'center', region: 'central_print_engine' },
  IRD: { anchorX: 70, anchorY: 58, labelX: 80, labelY: 43, labelAlign: 'right', region: 'right_imaging_delivery' },
  QCS: { anchorX: 75, anchorY: 43, labelX: 87, labelY: 27, labelAlign: 'right', region: 'right_imaging_delivery' },
  BSS: { anchorX: 78, anchorY: 64, labelX: 88, labelY: 72, labelAlign: 'right', region: 'right_imaging_delivery' },
  STS: { anchorX: 84, anchorY: 49, labelX: 94, labelY: 54, labelAlign: 'right', region: 'right_imaging_delivery' },
  IPU: { anchorX: 89, anchorY: 66, labelX: 94, labelY: 84, labelAlign: 'right', region: 'right_imaging_delivery' },
  FEC: { anchorX: 93, anchorY: 52, labelX: 95, labelY: 36, labelAlign: 'right', region: 'right_imaging_delivery' },
  CWS: { anchorX: 34, anchorY: 70, labelX: 28, labelY: 89, labelAlign: 'center', region: 'lower_services' },
  PSS: { anchorX: 55, anchorY: 72, labelX: 53, labelY: 91, labelAlign: 'center', region: 'lower_services' },
  Dryer: { anchorX: 68, anchorY: 71, labelX: 70, labelY: 90, labelAlign: 'center', region: 'right_imaging_delivery' },
  LLCI: { anchorX: 46, anchorY: 58, labelX: 43, labelY: 78, labelAlign: 'center', region: 'central_print_engine' }
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
