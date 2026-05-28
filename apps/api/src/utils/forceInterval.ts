import type { AppSettings } from "@wm-ddns/shared";

export function resolveForceIntervalSec(
  hostnameForceIntervalSec: number | null | undefined,
  settings: AppSettings,
  envFallbackSec?: number,
): number {
  if (hostnameForceIntervalSec != null) {
    return hostnameForceIntervalSec;
  }
  if (settings.defaultForceIntervalSec != null) {
    return settings.defaultForceIntervalSec;
  }
  return envFallbackSec ?? 3600;
}

export function isForceDue(
  lastUpdateAt: string | null | undefined,
  forceIntervalSec: number,
  now: Date,
): boolean {
  if (forceIntervalSec <= 0) return false;
  if (!lastUpdateAt) return true;
  const ageMs = now.getTime() - new Date(lastUpdateAt).getTime();
  return ageMs >= forceIntervalSec * 1000;
}
