import { MAX_STATE_LOOKUP_GAP_MS } from './config.js';
import { normalizeState } from './evaluation.js';

export function createStateTimeline(points = [], selectedRange = {}) {
  const transitions = [];
  for (const point of points) {
    const state = normalizeState(point.machineState || point.rawState);
    if (!Number.isFinite(point.timestampMs) || !state) continue;
    const last = transitions[transitions.length - 1];
    if (!last || last.state !== state || last.timestampMs !== point.timestampMs) transitions.push({ state, timestampMs: point.timestampMs });
  }
  transitions.sort((a, b) => a.timestampMs - b.timestampMs);
  const start = selectedRange.startTimestampMs ?? transitions[0]?.timestampMs ?? null;
  const end = selectedRange.endTimestampMs ?? transitions[transitions.length - 1]?.timestampMs ?? start;
  const intervals = [];
  for (let i = 0; i < transitions.length; i += 1) {
    const current = transitions[i];
    const next = transitions[i + 1];
    const startTimestampMs = Math.max(current.timestampMs, start ?? current.timestampMs);
    const endTimestampMs = Math.min(next?.timestampMs ?? end ?? current.timestampMs, end ?? next?.timestampMs ?? current.timestampMs);
    if (!Number.isFinite(startTimestampMs) || !Number.isFinite(endTimestampMs) || endTimestampMs <= startTimestampMs) continue;
    const previous = intervals[intervals.length - 1];
    if (previous?.state === current.state && previous.endTimestampMs === startTimestampMs) {
      previous.endTimestampMs = endTimestampMs;
      previous.durationMs = previous.endTimestampMs - previous.startTimestampMs;
    } else {
      intervals.push({ state: current.state, startTimestampMs, endTimestampMs, durationMs: endTimestampMs - startTimestampMs });
    }
  }
  return intervals;
}

export function createStateResolver(timeline = [], maxLookupGapMs = MAX_STATE_LOOKUP_GAP_MS) {
  return function resolve(timestampMs) {
    if (!Number.isFinite(timestampMs)) return { machineState: null, systemState: null, status: 'missing' };
    let lo = 0;
    let hi = timeline.length - 1;
    let match = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].startTimestampMs <= timestampMs) { match = timeline[mid]; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (!match) return { machineState: null, systemState: null, status: 'missing' };
    if (timestampMs <= match.endTimestampMs) return { machineState: match.state, systemState: match.state, status: 'matched' };
    const age = timestampMs - match.endTimestampMs;
    if (age > maxLookupGapMs) return { machineState: match.state, systemState: match.state, status: 'too_old' };
    return { machineState: match.state, systemState: match.state, status: 'previous_state' };
  };
}
