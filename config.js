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

export const STATUS_TAXONOMY = {
  critical: { key: 'critical', label: 'Critical', shortLabel: 'Critical', icon: '⚠', cssClass: 'critical', priority: 70, colorRole: 'critical', explanation: 'A fully evaluated actual value is outside a configured critical threshold.' },
  warning: { key: 'warning', label: 'Warning', shortLabel: 'Warning', icon: '!', cssClass: 'warning', priority: 60, colorRole: 'warning', explanation: 'A fully evaluated actual value is outside the permitted or warning range.' },
  needs_validation: { key: 'needs_validation', label: 'Validation required', shortLabel: 'Validate', icon: '◇', cssClass: 'needs-validation', priority: 50, colorRole: 'validation', explanation: 'Source data was found, but missing or invalid context prevents evaluation.' },
  needs_configuration: { key: 'needs_configuration', label: 'Configuration required', shortLabel: 'Configure', icon: '⚙', cssClass: 'needs-configuration', priority: 45, colorRole: 'configuration', explanation: 'Valid log data was found, but the rule lacks expected values, tolerances, thresholds, or evaluator support.' },
  ok: { key: 'ok', label: 'OK', shortLabel: 'OK', icon: '✓', cssClass: 'ok', priority: 30, colorRole: 'ok', explanation: 'The rule was fully evaluated and relevant values are inside the configured range.' },
  no_data: { key: 'no_data', label: 'No data', shortLabel: 'No data', icon: '∅', cssClass: 'no-data', priority: 20, colorRole: 'no-data', explanation: 'A valid rule exists, but no matching log value was found.' },
  no_rule: { key: 'no_rule', label: 'No rule', shortLabel: 'No rule', icon: '—', cssClass: 'no-rule', priority: 10, colorRole: 'no-data', explanation: 'No evaluation rule exists for this system.' },
  not_analyzed: { key: 'not_analyzed', label: 'Not analyzed', shortLabel: 'Pending', icon: '○', cssClass: 'not-analyzed', priority: 0, colorRole: 'no-data', explanation: 'No AnalysisResult is available yet.' }
};

export const STATUS_PRIORITY = { ...Object.fromEntries(Object.entries(STATUS_TAXONOMY).map(([key, meta]) => [key, meta.priority])), evaluator_pending: STATUS_TAXONOMY.needs_validation.priority };
export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS_TAXONOMY).map(([key, meta]) => [key, meta.label]));

export const EXPECTED_STATE_COLUMNS = {
  ON: 'Expected ON',
  Standby: 'Expected Standby',
  Ready: 'Expected Ready',
  Prepare2Print: 'Expected Prepare2Print',
  Printing: 'Expected Printing',
  PrintEnd: 'Expected PrintEnd',
  Recovery: 'Expected Recovery',
  Error: 'Expected Error'
};

export const SUPPORTED_CHECK_TYPES = new Set(['range', 'range_percent', 'above threshold', 'below threshold', 'exact', 'max', 'min']);
export const PENDING_CHECK_TYPES = new Set(['delta', 'trend', 'flatline']);
