import type { AppSettings, PublicIpDetectionMode } from "@wm-ddns/shared";
import { classifyIp } from "../utils/ip.js";

export interface PublicIpConsensusMeta {
  ipv4Votes: Record<string, number>;
  ipv6Votes: Record<string, number>;
  disagreements: string[];
}

export interface PublicIpSnapshot {
  ipv4: string | null;
  ipv6: string | null;
  fetchedAt: Date | null;
  consensus?: PublicIpConsensusMeta;
}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetches the host's public IP from configured providers (failover or consensus).
 */
export class PublicIpService {
  private cache: PublicIpSnapshot = { ipv4: null, ipv6: null, fetchedAt: null };
  private mode: PublicIpDetectionMode = "consensus";
  private minAgreements = 2;

  constructor(
    private providers: string[],
    private readonly logger: { warn: (msg: string, ...rest: unknown[]) => void },
  ) {}

  setProviders(urls: string[]): void {
    this.providers = [...urls];
    this.cache = { ipv4: null, ipv6: null, fetchedAt: null };
  }

  applySettings(settings: Pick<AppSettings, "publicIpDetectionMode" | "publicIpMinAgreements">): void {
    this.mode = settings.publicIpDetectionMode;
    this.minAgreements = settings.publicIpMinAgreements;
  }

  snapshot(): PublicIpSnapshot {
    return { ...this.cache, consensus: this.cache.consensus ? { ...this.cache.consensus } : undefined };
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

    const urls = this.providers.filter(Boolean);
    if (urls.length === 0) {
      this.cache = { ipv4: null, ipv6: null, fetchedAt: new Date() };
      return this.snapshot();
    }

    let result: PublicIpSnapshot;
    if (this.mode === "consensus") {
      result = await this.detectConsensus(urls);
      if (!result.ipv4 && !result.ipv6) {
        this.logger.warn("consensus failed; falling back to failover");
        result = await this.detectFailover(urls);
      }
    } else {
      result = await this.detectFailover(urls);
    }

    this.cache = result;
    return this.snapshot();
  }

  private async detectFailover(urls: string[]): Promise<PublicIpSnapshot> {
    let ipv4: string | null = null;
    let ipv6: string | null = null;
    for (const url of urls) {
      const ip = await this.fetchOne(url);
      if (!ip) continue;
      if (ip.kind === "ipv4" && !ipv4) ipv4 = ip.value;
      if (ip.kind === "ipv6" && !ipv6) ipv6 = ip.value;
      if (ipv4 && ipv6) break;
    }
    return { ipv4, ipv6, fetchedAt: new Date() };
  }

  private async detectConsensus(urls: string[]): Promise<PublicIpSnapshot> {
    const results = await Promise.allSettled(urls.map((url) => this.fetchOne(url)));
    const ipv4Votes: Record<string, number> = {};
    const ipv6Votes: Record<string, number> = {};
    const disagreements: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const url = urls[i];
      if (!r || !url) continue;
      if (r.status === "rejected") {
        disagreements.push(`${url}: failed`);
        continue;
      }
      const valueResult = r.value;
      if (!valueResult) {
        disagreements.push(`${url}: failed`);
        continue;
      }
      const { kind, value } = valueResult;
      if (kind === "ipv4") ipv4Votes[value] = (ipv4Votes[value] ?? 0) + 1;
      else ipv6Votes[value] = (ipv6Votes[value] ?? 0) + 1;
    }

    const ipv4 = pickConsensus(ipv4Votes, this.minAgreements);
    const ipv6 = pickConsensus(ipv6Votes, this.minAgreements);

    const uniqueV4 = Object.keys(ipv4Votes);
    const uniqueV6 = Object.keys(ipv6Votes);
    if (uniqueV4.length > 1) {
      disagreements.push(`ipv4 split: ${uniqueV4.join(", ")}`);
    }
    if (uniqueV6.length > 1) {
      disagreements.push(`ipv6 split: ${uniqueV6.join(", ")}`);
    }

    return {
      ipv4,
      ipv6,
      fetchedAt: new Date(),
      consensus: { ipv4Votes, ipv6Votes, disagreements },
    };
  }

  private async fetchOne(url: string): Promise<{ kind: "ipv4" | "ipv6"; value: string } | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "text/plain" },
      });
      if (!res.ok) return null;
      const text = (await res.text()).trim();
      const kind = classifyIp(text);
      if (kind === "ipv4" || kind === "ipv6") return { kind, value: text };
      return null;
    } catch (err) {
      this.logger.warn(`public IP provider ${url} failed: ${(err as Error).message}`);
      return null;
    }
  }
}

function pickConsensus(votes: Record<string, number>, minAgreements: number): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [ip, count] of Object.entries(votes)) {
    if (count >= minAgreements && count > bestCount) {
      best = ip;
      bestCount = count;
    }
  }
  return best;
}
