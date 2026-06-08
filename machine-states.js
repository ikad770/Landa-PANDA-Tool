import { MAX_STATE_LOOKUP_GAP_MS } from './config.js';
import { normalizeState } from './evaluation.js';

export function createStateTimeline(points = [], selectedRange = {}) {
  const transitions = [];
  for (const point of points) {
    const raw = point.machineState || point.rawState || point.systemState;
    const state = normalizeState(raw) || raw;
    if (!Number.isFinite(point.timestampMs) || !state) continue;
    transitions.push({ state, timestampMs: point.timestampMs });
  }
  return transitionsToIntervals(transitions, selectedRange);
}

export function createSystemStateTimelines(points = [], selectedRange = {}) {
  const grouped = new Map();
  for (const point of points) {
    const system = point.subsystem || point.component || point.stateStream;
    const raw = point.systemState || point.rawState || point.machineState;
    const state = normalizeState(raw) || raw;
    if (!system || !Number.isFinite(point.timestampMs) || !state) continue;
    if (!grouped.has(system)) grouped.set(system, []);
    grouped.get(system).push({ state, timestampMs: point.timestampMs, sourceType: point.sourceType || null });
  }
  const timelines = {};
  for (const [system, transitions] of grouped) timelines[system] = transitionsToIntervals(transitions, selectedRange);
  return timelines;
}

function transitionsToIntervals(input = [], selectedRange = {}) {
  const transitions = [...input].sort((a, b) => a.timestampMs - b.timestampMs);
  const deduped = [];
  for (const transition of transitions) {
    const last = deduped[deduped.length - 1];
    if (last && last.state === transition.state && last.timestampMs === transition.timestampMs) continue;
    if (last && last.state === transition.state) continue;
    deduped.push(transition);
  }
  const start = selectedRange.startTimestampMs ?? deduped[0]?.timestampMs ?? null;
  const end = selectedRange.endTimestampMs ?? deduped[deduped.length - 1]?.timestampMs ?? start;
  const intervals = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const current = deduped[i];
    const next = deduped[i + 1];
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
    const resolved = resolveTimeline(timeline, timestampMs, maxLookupGapMs);
    return { machineState: resolved.state, systemState: resolved.state, status: resolved.status };
  };
}

export function resolveTimeline(timeline = [], timestampMs, maxLookupGapMs = MAX_STATE_LOOKUP_GAP_MS) {
  if (!Number.isFinite(timestampMs)) return { state: null, status: 'missing' };
  let lo = 0;
  let hi = timeline.length - 1;
  let match = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].startTimestampMs <= timestampMs) { match = timeline[mid]; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (!match) return { state: null, status: 'missing' };
  if (timestampMs <= match.endTimestampMs) return { state: match.state, status: 'matched' };
  const age = timestampMs - match.endTimestampMs;
  if (age > maxLookupGapMs) return { state: match.state, status: 'too_old' };
  return { state: match.state, status: 'previous_state' };
}
