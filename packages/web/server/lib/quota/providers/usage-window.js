import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { asObject, buildResult, toUsageWindow } from '../utils/index.js';

export const providerId = 'usage-window';
export const providerName = 'Usage Window (local)';

// Local estimate for providers without a quota API (e.g. free models). The
// opencode `usage-window` plugin counts tokens/requests per provider/model in a
// fixed window that opens on the first request, and records how much had been
// used whenever a rate limit was hit. The median of those samples is the
// estimated limit. No credentials are involved; the state file is the only input.
const WINDOW_SECONDS = Number(process.env.USAGE_WINDOW_HOURS ?? 5) * 3600;

export const getStatePath = () => process.env.USAGE_WINDOW_FILE
  ?? path.join(os.homedir(), '.local', 'share', 'opencode-usage-window', 'state.json');

const readStateFile = async () => JSON.parse(await readFile(getStatePath(), 'utf8'));

export const isConfigured = () => existsSync(getStatePath());

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

const formatCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export const toWindow = (bucket, now = Date.now()) => {
  const window = asObject(bucket?.window);
  if (!window || !Number.isFinite(window.start)) return null;
  const resetAt = window.start + WINDOW_SECONDS * 1000;
  if (now >= resetAt) return null;

  const samples = Array.isArray(bucket.samples) ? bucket.samples : [];
  const tokenLimit = finite(bucket.manualLimit?.tokens) ?? median(samples.map((s) => s?.tokens).filter(finite));
  const requestLimit = finite(bucket.manualLimit?.requests) ?? median(samples.map((s) => s?.requests).filter(finite));
  const tokens = Number(window.tokens) || 0;
  const requests = Number(window.requests) || 0;

  // Whichever dimension runs out first decides the percentage.
  const ratios = [tokenLimit && tokens / tokenLimit, requestLimit && requests / requestLimit].filter(Number.isFinite);
  const usedPercent = window.limitHitAt
    ? 100
    : ratios.length ? Math.min(100, Math.round(Math.max(...ratios) * 100)) : null;

  const counts = `${formatCount(tokens)} tokens · ${requests} reqs`;
  return toUsageWindow({
    usedPercent,
    windowSeconds: WINDOW_SECONDS,
    resetAt,
    // Before the first rate limit there is no estimate, so show raw counts instead of a percentage.
    ...(usedPercent === null ? { valueLabel: `${counts} (uncalibrated)` } : {})
  });
};

export const fetchQuota = async ({ readState = readStateFile, now = Date.now() } = {}) => {
  let state;
  try {
    state = asObject(await readState());
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: !missing,
      error: missing ? 'Not configured' : 'Invalid usage-window state file'
    });
  }

  const windows = {};
  for (const [key, bucket] of Object.entries(asObject(state?.buckets) ?? {})) {
    const window = toWindow(asObject(bucket), now);
    if (window) windows[key] = window;
  }

  if (Object.keys(windows).length === 0) {
    return buildResult({ providerId, providerName, ok: false, configured: true, error: 'No active window' });
  }

  return buildResult({ providerId, providerName, ok: true, configured: true, usage: { windows } });
};
