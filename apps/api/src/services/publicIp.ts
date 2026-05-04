import { classifyIp } from "../utils/ip.js";

export interface PublicIpSnapshot {
  ipv4: string | null;
  ipv6: string | null;
  fetchedAt: Date | null;
}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetches the host's public IP from a list of providers with failover.
 * Caches the last good result for `CACHE_TTL_MS` so concurrent callers
 * (multiple hostnames + the scheduler) don't hammer the upstream.
 */
export class PublicIpService {
  private cache: PublicIpSnapshot = { ipv4: null, ipv6: null, fetchedAt: null };

  constructor(
    private readonly providers: string[],
    private readonly logger: { warn: (msg: string, ...rest: unknown[]) => void },
  ) {}

  snapshot(): PublicIpSnapshot {
    return { ...this.cache };
  }

  async detect(force = false): Promise<PublicIpSnapshot> {
    const now = Date.now();
    if (
      !force &&
      this.cache.fetchedAt &&
      now - this.cache.fetchedAt.getTime() < CACHE_TTL_MS &&
      (this.cache.ipv4 || this.cache.ipv6)
    ) {
      return this.snapshot();
    }
    let ipv4: string | null = null;
    let ipv6: string | null = null;
    for (const url of this.providers) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { Accept: "text/plain" },
        });
        if (!res.ok) continue;
        const text = (await res.text()).trim();
        const kind = classifyIp(text);
        if (kind === "ipv4" && !ipv4) ipv4 = text;
        if (kind === "ipv6" && !ipv6) ipv6 = text;
        if (ipv4 && ipv6) break;
      } catch (err) {
        this.logger.warn(`public IP provider ${url} failed: ${(err as Error).message}`);
      }
    }
    this.cache = { ipv4, ipv6, fetchedAt: new Date() };
    return this.snapshot();
  }
}
