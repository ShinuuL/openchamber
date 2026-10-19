import { describe, expect, it } from 'vitest';
import { fetchQuota } from './usage-window.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const HOUR = 3_600_000;

const bucket = (window, extra = {}) => ({ window: { tokens: 0, requests: 0, ...window }, samples: [], ...extra });

describe('usage-window quota provider', () => {
  it('reports raw counts while uncalibrated', async () => {
    const result = await fetchQuota({
      now: NOW,
      readState: async () => ({ buckets: { 'opencode/free': bucket({ start: NOW - HOUR, tokens: 12_345, requests: 7 }) } })
    });
    const w = result.usage.windows['opencode/free'];
    expect(result.ok).toBe(true);
    expect(w.usedPercent).toBeNull();
    expect(w.valueLabel).toBe('12.3k tokens · 7 reqs (uncalibrated)');
    expect(w.windowSeconds).toBe(18_000);
    expect(w.resetAt).toBe(NOW + 4 * HOUR);
  });

  it('uses the median of rate-limit samples and the tighter dimension', async () => {
    const samples = [
      { tokens: 100_000, requests: 50 },
      { tokens: 200_000, requests: 100 },
      { tokens: 300_000, requests: 150 }
    ];
    const result = await fetchQuota({
      now: NOW,
      readState: async () => ({ buckets: { m: bucket({ start: NOW - HOUR, tokens: 50_000, requests: 75 }, { samples }) } })
    });
    // tokens 25%, requests 75% -> 75
    expect(result.usage.windows.m.usedPercent).toBe(75);
    expect(result.usage.windows.m.valueLabel).toBeUndefined();
  });

  it('prefers a manual limit, caps at 100 and reports 100 after a hit', async () => {
    const result = await fetchQuota({
      now: NOW,
      readState: async () => ({ buckets: {
        a: bucket({ start: NOW - HOUR, requests: 300 }, { manualLimit: { requests: 200 } }),
        b: bucket({ start: NOW - HOUR, limitHitAt: NOW - 1000 })
      } })
    });
    expect(result.usage.windows.a.usedPercent).toBe(100);
    expect(result.usage.windows.b.usedPercent).toBe(100);
  });

  it('drops expired windows', async () => {
    const result = await fetchQuota({
      now: NOW,
      readState: async () => ({ buckets: { old: bucket({ start: NOW - 6 * HOUR }) } })
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No active window');
  });

  it('distinguishes a missing file from a broken one', async () => {
    const missing = await fetchQuota({ readState: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
    expect(missing.configured).toBe(false);
    const broken = await fetchQuota({ readState: async () => { throw new SyntaxError('bad json'); } });
    expect(broken.configured).toBe(true);
    expect(broken.error).toBe('Invalid usage-window state file');
  });
});
