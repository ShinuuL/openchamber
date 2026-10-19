export type UsageWindowQuotaWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowSeconds: number | null;
  resetAfterSeconds: number | null;
  resetAt: number | null;
  resetAtFormatted: string | null;
  resetAfterFormatted: string | null;
  valueLabel?: string;
};

export type UsageWindowQuotaResult = {
  providerId: string;
  providerName: string;
  ok: boolean;
  configured: boolean;
  usage: { windows: Record<string, UsageWindowQuotaWindow> } | null;
  error?: string;
  fetchedAt: number;
};

export const providerId: 'usage-window';
export const providerName: string;
export function getStatePath(): string;
export function isConfigured(): boolean;
export function toWindow(bucket: unknown, now?: number): UsageWindowQuotaWindow | null;
export function fetchQuota(options?: { readState?: () => Promise<unknown>; now?: number }): Promise<UsageWindowQuotaResult>;
