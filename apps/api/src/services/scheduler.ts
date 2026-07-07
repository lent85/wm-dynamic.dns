import cron, { type ScheduledTask } from "node-cron";
import dns from "node:dns/promises";
import type { FastifyBaseLogger } from "fastify";
import { getEnabledPublicIpProviderUrls } from "@wm-ddns/shared";
import type { HostnameService } from "./hostnames.js";
import type { PublicIpService } from "./publicIp.js";
import type { UpdateProcessor } from "./updateProcessor.js";
import type { SettingsService } from "./settings.js";
import { classifyIp } from "../utils/ip.js";

interface SchedulerDeps {
  hostnameService: HostnameService;
  updateProcessor: UpdateProcessor;
  publicIpService: PublicIpService;
  settingsService: SettingsService;
  ipHistory?: unknown;
  logger: FastifyBaseLogger;
  timezone: string;
  selfDetectIntervalSec: number;
  envDefaultForceIntervalSec?: number;
}

export class Scheduler {
  private readonly hostnameTasks = new Map<number, { expr: string; task: ScheduledTask }>();
  private selfDetectTask: ScheduledTask | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.syncHostnameTasks();
    this.startSelfDetect();
  }

  stop(): void {
    for (const { task } of this.hostnameTasks.values()) {
      task.stop();
    }
    this.hostnameTasks.clear();
    this.stopSelfDetectOnly();
  }

  reloadSelfDetect(): void {
    this.stopSelfDetectOnly();
    this.startSelfDetect();
  }

  reloadFromSettings(): void {
    this.reloadSelfDetect();
    const settings = this.deps.settingsService.get();
    const publicIp = this.deps.publicIpService as unknown as {
      applySettings?: (s: unknown) => void;
      setProviders: (urls: string[]) => void;
    };
    if (typeof publicIp.applySettings === "function") {
      publicIp.applySettings(settings);
    }
    publicIp.setProviders(getEnabledPublicIpProviderUrls(settings));
  }

  private stopSelfDetectOnly(): void {
    if (this.selfDetectTask) {
      this.selfDetectTask.stop();
      this.selfDetectTask = null;
    }
  }

  syncHostnameTasks(): void {
    const wanted = this.deps.hostnameService.listScheduled();
    const wantedById = new Map(wanted.map((h) => [h.id, h]));

    for (const [id, entry] of this.hostnameTasks) {
      const next = wantedById.get(id);
      if (!next || next.scheduleCron !== entry.expr) {
        entry.task.stop();
        this.hostnameTasks.delete(id);
      }
    }

    for (const h of wanted) {
      if (this.hostnameTasks.has(h.id)) continue;
      try {
        const task = cron.schedule(
          h.scheduleCron,
          () => {
            void this.runScheduledTick(h.id);
          },
          { timezone: this.deps.timezone, scheduled: true },
        );
        this.hostnameTasks.set(h.id, { expr: h.scheduleCron, task });
        this.deps.logger.info(
          { hostnameId: h.id, hostname: h.hostname, cron: h.scheduleCron, tz: this.deps.timezone },
          "scheduled hostname",
        );
      } catch (err) {
        this.deps.logger.error(
          { err, hostnameId: h.id, cron: h.scheduleCron },
          "failed to register cron task",
        );
      }
    }
  }

  startSelfDetect(): void {
    const cfg = this.deps.settingsService.get();
    const intervalSec = cfg.selfDetectEnabled
      ? Math.max(60, cfg.selfDetectIntervalSec || this.deps.selfDetectIntervalSec)
      : 0;
    if (intervalSec <= 0) {
      this.deps.logger.info("self-IP detect disabled");
      return;
    }
    const minutes = Math.max(1, Math.round(intervalSec / 60));
    const expr = `*/${minutes} * * * *`;
    this.selfDetectTask = cron.schedule(
      expr,
      () => {
        void this.runSelfDetectTick();
      },
      { timezone: this.deps.timezone, scheduled: true },
    );
    this.deps.logger.info({ expr, tz: this.deps.timezone }, "self-IP detect job scheduled");
  }

  async runSelfDetectTick(): Promise<void> {
    // ── 1. Hostnames that track the server's own public IP ──────────────────
    const tracked = this.deps.hostnameService.listSelfTracked();
    if (tracked.length > 0) {
      // Always force a fresh probe — the 60 s cache is too stale relative to a
      // 5-min cron cycle and would return the old IP even after it has changed.
      const ip = await this.deps.publicIpService.detect(true);
      if (!ip.ipv4 && !ip.ipv6) {
        this.deps.logger.warn("self-detect: could not resolve any public IP");
      } else {
        for (const h of tracked) {
          try {
            await this.deps.updateProcessor.process({
              hostnameId: h.id,
              source: "self-detect",
              ipv4: ip.ipv4,
              ipv6: ip.ipv6,
            });
          } catch (err) {
            this.deps.logger.error(
              { err, hostnameId: h.id },
              "self-detect tick failed for hostname",
            );
          }
        }
      }
    }

    // ── 2. Hostnames with a custom URL or follow-domain source ──────────────
    const others = this.deps.hostnameService.listOtherTracked();
    for (const h of others) {
      try {
        let ipv4: string | null = null;
        let ipv6: string | null = null;

        if (h.ipSourceUrl) {
          const res = await fetchIpFromUrl(h.ipSourceUrl);
          ipv4 = res.ipv4;
          ipv6 = res.ipv6;
        } else if (h.ipSourceDomain) {
          const res = await resolveIpFromDomain(h.ipSourceDomain);
          ipv4 = res.ipv4;
          ipv6 = res.ipv6;
        }

        if (!ipv4 && !ipv6) {
          this.deps.logger.warn(
            { hostnameId: h.id, ipSourceUrl: h.ipSourceUrl, ipSourceDomain: h.ipSourceDomain },
            "self-detect: could not resolve IP for custom-source hostname",
          );
          continue;
        }

        await this.deps.updateProcessor.process({
          hostnameId: h.id,
          source: "self-detect",
          ipv4,
          ipv6,
        });
      } catch (err) {
        this.deps.logger.error(
          { err, hostnameId: h.id },
          "self-detect tick failed for custom-source hostname",
        );
      }
    }
  }

  private async runScheduledTick(hostnameId: number): Promise<void> {
    const h = this.deps.hostnameService.get(hostnameId);
    if (!h || !h.enabled) return;
    let ipv4: string | null = h.lastIpv4;
    let ipv6: string | null = h.lastIpv6;

    if (h.trackSelfIp) {
      // trackSelfIp = true → always detect the server's current public IP.
      const ip = await this.deps.publicIpService.detect(true);
      ipv4 = ip.ipv4;
      ipv6 = ip.ipv6;
    } else if (h.ipSourceUrl) {
      // Pull from custom HTTP API URL.
      const res = await fetchIpFromUrl(h.ipSourceUrl);
      ipv4 = res.ipv4 ?? ipv4;
      ipv6 = res.ipv6 ?? ipv6;
    } else if (h.ipSourceDomain) {
      // Resolve A/AAAA of a follow-domain.
      const res = await resolveIpFromDomain(h.ipSourceDomain);
      ipv4 = res.ipv4 ?? ipv4;
      ipv6 = res.ipv6 ?? ipv6;
    } else if (!ipv4 && !ipv6) {
      // No IP at all yet (e.g. first run for a token-push hostname) — probe once.
      const ip = await this.deps.publicIpService.detect(true);
      ipv4 = ip.ipv4;
      ipv6 = ip.ipv6;
    }
    // If trackSelfIp=false and no URL/domain configured (token-push mode), we just
    // re-push the stored lastIpv4/lastIpv6 per the force-interval logic (nochg skips it).

    try {
      await this.deps.updateProcessor.process({
        hostnameId: hostnameId,
        source: "schedule",
        ipv4,
        ipv6,
      });
    } catch (err) {
      this.deps.logger.error(
        { err, hostnameId },
        "scheduled tick failed",
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetches the body of a URL and tries to parse it as a plain-text IP address.
 * Returns both IPv4 and IPv6 slots; at most one will be non-null per request.
 */
async function fetchIpFromUrl(
  url: string,
): Promise<{ ipv4: string | null; ipv6: string | null }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return { ipv4: null, ipv6: null };
    const text = (await res.text()).trim();
    const kind = classifyIp(text);
    if (kind === "ipv4") return { ipv4: text, ipv6: null };
    if (kind === "ipv6") return { ipv4: null, ipv6: text };
  } catch {
    // Network error or timeout — silently return nulls; the caller will warn.
  }
  return { ipv4: null, ipv6: null };
}

/**
 * Resolves the A and AAAA records of `domain` using the system DNS resolver.
 * Returns the first address of each family (or null if unavailable).
 */
async function resolveIpFromDomain(
  domain: string,
): Promise<{ ipv4: string | null; ipv6: string | null }> {
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  try {
    const a = await dns.resolve4(domain);
    if (a && a.length > 0) ipv4 = a[0] ?? null;
  } catch {
    // NXDOMAIN or no A record — not an error worth logging at warn level.
  }
  try {
    const aaaa = await dns.resolve6(domain);
    if (aaaa && aaaa.length > 0) ipv6 = aaaa[0] ?? null;
  } catch {
    // No AAAA record.
  }
  return { ipv4, ipv6 };
}
