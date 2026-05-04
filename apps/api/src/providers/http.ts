/**
 * Tiny shared HTTP helper for provider plugins.
 *
 * - Uses Node's built-in fetch (undici), so no extra deps.
 * - Adds a sane default timeout (15s) via AbortSignal.timeout().
 * - Returns the response body as text (DDNS providers all use plain text).
 */

const DEFAULT_TIMEOUT_MS = 15000;

export interface ProviderHttpResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function providerFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<ProviderHttpResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...rest } = init ?? {};
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutSignal])
    : timeoutSignal;
  const res = await fetch(url, { ...rest, signal });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

export function truncate(s: string, max = 512): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}
