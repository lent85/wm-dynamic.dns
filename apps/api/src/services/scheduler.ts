import cron, { type ScheduledTask } from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import type { HostnameService } from "./hostnames.js";
import type { PublicIpService } from "./publicIp.js";
import type { UpdateProcessor } from "./updateProcessor.js";
import type { SettingsService } from "./settings.js";

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
    if (Array.isArray(settings.publicIpProviders) && settings.publicIpProviders.length > 0) {
      publicIp.setProviders(settings.publicIpProviders);
    }
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
    const tracked = this.deps.hostnameService.listSelfTracked();
    if (tracked.length === 0) return;
    const ip = await this.deps.publicIpService.detect();
    if (!ip.ipv4 && !ip.ipv6) {
      this.deps.logger.warn("self-detect: could not resolve any public IP");
      return;
    }
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

  private async runScheduledTick(hostnameId: number): Promise<void> {
    const h = this.deps.hostnameService.get(hostnameId);
    if (!h || !h.enabled) return;
    let ipv4: string | null = h.lastIpv4;
    let ipv6: string | null = h.lastIpv6;

    if (h.trackSelfIp || (!ipv4 && !ipv6)) {
      // Scheduled runs should use a fresh probe; stale cache can hide recent IP flips
      // and make schedule behave differently from manual force-update.
      const ip = await this.deps.publicIpService.detect(true);
      ipv4 = ip.ipv4;
      ipv6 = ip.ipv6;
    }
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
