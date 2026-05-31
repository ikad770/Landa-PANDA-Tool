import { MACHINE_ID_PATTERN, MACHINE_ID_SEARCH_PATTERN } from '../utils/constants.js';

export function normalizePath(path) {
  return String(path || '').replaceAll('\\\\', '/').replaceAll('\\', '/');
}

export function detectMachineId(path, fallback = 'UNASSIGNED') {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  const direct = segments.find((segment) => MACHINE_ID_PATTERN.test(segment));
  if (direct) return direct.toUpperCase();

  const matched = normalized.match(MACHINE_ID_SEARCH_PATTERN);
  if (matched?.[1]) return matched[1].toUpperCase();

  const zipSegment = segments.find((segment) => /^[SD]\d{6,}.*\.zip$/i.test(segment));
  if (zipSegment) return zipSegment.replace(/\.zip$/i, '').toUpperCase();

  return fallback;
}

export function machineSort(a, b) {
  if (a.id === 'UNASSIGNED') return 1;
  if (b.id === 'UNASSIGNED') return -1;
  return a.id.localeCompare(b.id);
}
