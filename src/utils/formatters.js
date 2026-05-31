export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

export function formatList(values, empty = 'None') {
  if (!values || values.length === 0) return empty;
  return values.join(', ');
}

export function formatRange(low, high, unit = '') {
  const suffix = unit ? ` ${unit}` : '';
  if (low == null && high == null) return 'Not configured';
  if (low != null && high != null) return `${low}${suffix} to ${high}${suffix}`;
  if (low != null) return `>= ${low}${suffix}`;
  return `<= ${high}${suffix}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return 'Not configured';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function statusLabel(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}
