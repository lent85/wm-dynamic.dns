import { isIP } from "node:net";

export type IpKind = "ipv4" | "ipv6" | "invalid";

export function classifyIp(value: string): IpKind {
  const v = isIP(value);
  if (v === 4) return "ipv4";
  if (v === 6) return "ipv6";
  return "invalid";
}

export function isIPv4(value: string): boolean {
  return isIP(value) === 4;
}

export function isIPv6(value: string): boolean {
  return isIP(value) === 6;
}

/**
 * Picks the client's source IP from a Fastify-style request.
 *
 * When `trustProxy` is enabled, Fastify's `request.ip` already honors
 * X-Forwarded-For. We additionally normalize IPv6-mapped IPv4 (::ffff:1.2.3.4).
 */
export function normalizeRemoteIp(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("::ffff:")) {
    const stripped = raw.slice("::ffff:".length);
    if (isIP(stripped)) return stripped;
  }
  return isIP(raw) ? raw : null;
}
