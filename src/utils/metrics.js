// metrics.js
// Per-request timing, grouped by REST resource type, for measuring import/export performance.
// Contains no identifiers: UUIDs are stripped from resource paths and query strings are dropped,
// so the summary is safe to share (the exported data itself is real patient data).
import fs from 'fs/promises';
import path from 'path';

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const timings = new Map();   // resource type -> { durations: [], errors: 0 }
const counters = new Map();  // name -> number
let startedAt = Date.now();

/**
 * Turns a REST URL into a resource type with no identifiers, e.g.
 *   .../ws/rest/v1/obs?patient=<uuid>&v=...  -> "GET obs (search)"
 *   .../ws/rest/v1/patient/<uuid>/allergy    -> "GET patient/allergy"
 *   .../ws/rest/v1/obs/<uuid>                -> "GET obs (by uuid)"
 */
export function resourceType(method, url) {
  const [pathPart, query] = String(url).split('?');
  const afterRest = pathPart.split('/ws/rest/v1/')[1] ?? pathPart;
  const segments = afterRest.split('/').filter(s => s.length > 0);
  const named = segments.filter(s => !UUID_SEGMENT.test(s));
  const byUuid = segments.length > 0 && UUID_SEGMENT.test(segments[segments.length - 1]);
  let type = `${method.toUpperCase()} ${named.join('/')}`;
  if (byUuid) {
    type += ' (by uuid)';
  } else if (query && method.toUpperCase() === 'GET') {
    type += ' (search)';
  }
  return type;
}

export function recordRequest(method, url, durationMs, ok = true) {
  const type = resourceType(method, url);
  let entry = timings.get(type);
  if (!entry) {
    entry = { durations: [], errors: 0 };
    timings.set(type, entry);
  }
  entry.durations.push(durationMs);
  if (!ok) {
    entry.errors++;
  }
}

export function increment(name, by = 1) {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function resetMetrics() {
  timings.clear();
  counters.clear();
  startedAt = Date.now();
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function summarizeMetrics() {
  const requests = {};
  let totalRequests = 0;
  for (const [type, { durations, errors }] of [...timings.entries()].sort()) {
    const sorted = [...durations].sort((a, b) => a - b);
    const totalMs = sorted.reduce((sum, d) => sum + d, 0);
    totalRequests += sorted.length;
    requests[type] = {
      count: sorted.length,
      errors,
      totalMs: Math.round(totalMs),
      meanMs: Math.round(totalMs / sorted.length),
      p50Ms: Math.round(percentile(sorted, 50)),
      p95Ms: Math.round(percentile(sorted, 95)),
      maxMs: Math.round(sorted[sorted.length - 1]),
    };
  }
  return {
    wallSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    totalRequests,
    counters: Object.fromEntries([...counters.entries()].sort()),
    requests,
  };
}

/**
 * Writes the summary as JSON to <dir>/<name>-<timestamp>.json and returns the summary and file path.
 */
export async function writeMetrics(dir, name, extra = {}) {
  const summary = { ...extra, ...summarizeMetrics() };
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(file, JSON.stringify(summary, null, 2));
  return { summary, file };
}
