import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppSettings, UpdateSource } from "@wm-ddns/shared";
import type { Db } from "../db/index.js";
import { hostnames, providers, updateLogs } from "../db/schema.js";
import { decryptJSON } from "../crypto/encrypt.js";
import { getProvider } from "../providers/registry.js";
import type { DnsRecordType } from "../providers/types.js";
import { isIPv4, isIPv6 } from "../utils/ip.js";
import { resolveForceIntervalSec } from "../utils/forceInterval.js";
import { KeyedMutex } from "./mutex.js";
import type { IpHistoryService } from "./ipHistory.js";
import type { SettingsService } from "./settings.js";

export interface ProcessUpdateInput {
  hostnameId: number;
  source: UpdateSource;
  ipv4?: string | null;
  ipv6?: string | null;
  /** Serialized consensus metadata from public IP detect (optional). */
  consensusJson?: string | null;
}

export interface RecordUpdateOutcome {
  recordType: DnsRecordType;
  ip: string;
  /** Was a request actually sent to the upstream provider? */
  dispatched: boolean;
  ok: boolean;
  /** "good" | "nochg" | "skip-disabled" | "skip-no-record-needed" | provider-specific */
  status: string;
  reason?: string;
}

export interface ProcessUpdateOutput {
  hostname: string;
  results: RecordUpdateOutcome[];
}

interface UpdateProcessorDeps {
  db: Db;
  encryptionKey: Buffer;
  logger: FastifyBaseLogger;
  settingsService: SettingsService;
  ipHistory: IpHistoryService;
  envDefaultForceIntervalSec?: number;
  /** Override "now" in tests. */
  now?: () => Date;
}

export class UpdateProcessor {
  private readonly mutex = new KeyedMutex<number>();
  private readonly now: () => Date;

  constructor(private readonly deps: UpdateProcessorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async process(input: ProcessUpdateInput): Promise<ProcessUpdateOutput> {
    return this.mutex.run(input.hostnameId, () => this.processInner(input));
  }

  private getSettings(): AppSettings {
    return this.deps.settingsService.get();
  }

  private async processInner(input: ProcessUpdateInput): Promise<ProcessUpdateOutput> {
    const { db, logger } = this.deps;
    const settings = this.getSettings();

    const hostRow = db
      .select()
      .from(hostnames)
      .where(eq(hostnames.id, input.hostnameId))
      .get();
    if (!hostRow) {
      throw new HostnameNotFoundError(input.hostnameId);
    }
    if (!hostRow.enabled) {
      return { hostname: hostRow.hostname, results: [] };
    }

    const targets = this.resolveTargets(hostRow.recordType, input.ipv4, input.ipv6);
    if (targets.length === 0) {
      return { hostname: hostRow.hostname, results: [] };
    }

    const providerRow = db
      .select()
      .from(providers)
      .where(eq(providers.id, hostRow.providerId))
      .get();
    if (!providerRow) {
      logger.error(
        { hostnameId: hostRow.id, providerId: hostRow.providerId },
        "provider not found for hostname",
      );
      throw new Error(`provider ${hostRow.providerId} not found`);
    }

    const plugin = getProvider(providerRow.type);
    if (!plugin) {
      throw new Error(`provider plugin "${providerRow.type}" not registered`);
    }

    let providerConfig: unknown;
    try {
      providerConfig = decryptJSON(providerRow.configEnc, this.deps.encryptionKey);
    } catch (err) {
      logger.error({ err, providerId: providerRow.id }, "failed to decrypt provider config");
      throw new Error(`provider ${providerRow.id} config is corrupted`);
    }

    const forceSec = resolveForceIntervalSec(
      hostRow.forceIntervalSec,
      settings,
      this.deps.envDefaultForceIntervalSec,
    );
    const forceMs = forceSec * 1000;

    const results: RecordUpdateOutcome[] = [];

    for (const target of targets) {
      const lastIp = target.recordType === "A" ? hostRow.lastIpv4 : hostRow.lastIpv6;
      const lastUpdate = hostRow.lastUpdateAt ? new Date(hostRow.lastUpdateAt) : null;
      const ageMs = lastUpdate ? this.now().getTime() - lastUpdate.getTime() : Infinity;

      const ipUnchanged = lastIp === target.ip;
      const forceDue = !lastUpdate || (forceMs > 0 && ageMs >= forceMs);
      const shouldDispatch = !ipUnchanged || forceDue;

      if (!shouldDispatch) {
        const detailMsg = `Service: ${providerRow.name} (${providerRow.type}). Detected IP: ${target.ip} (matches last IP: ${lastIp ?? "none"}). Skipped.`;
        this.writeLog({
          hostnameId: hostRow.id,
          source: input.source,
          recordType: target.recordType,
          requestedIp: target.ip,
          dispatched: false,
          ok: true,
          ipChanged: false,
          providerStatus: "nochg",
          responseText: detailMsg,
          durationMs: 0,
        });
        results.push({
          recordType: target.recordType,
          ip: target.ip,
          dispatched: false,
          ok: true,
          status: "nochg",
        });
        continue;
      }

      const startedAt = Date.now();
      let outcome;
      try {
        outcome = await plugin.updateRecord({
          config: providerConfig,
          hostname: hostRow.hostname,
          recordType: target.recordType,
          ip: target.ip,
          ttl: hostRow.ttl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outcome = { ok: false, status: "exception", raw: msg };
      }
      const durationMs = Date.now() - startedAt;

      const ipChanged = outcome.ok && !ipUnchanged;
      const ipChangeMsg = ipUnchanged
        ? `matches last IP: ${lastIp ?? "none"} (force interval due)`
        : `changed from last IP: ${lastIp ?? "none"}`;
      const detailMsg = `Service: ${providerRow.name} (${providerRow.type}). Detected IP: ${target.ip} (${ipChangeMsg}). Response: ${outcome.raw}`;

      this.writeLog({
        hostnameId: hostRow.id,
        source: input.source,
        recordType: target.recordType,
        requestedIp: target.ip,
        dispatched: true,
        ok: outcome.ok,
        ipChanged,
        providerStatus: outcome.status,
        responseText: detailMsg,
        durationMs,
      });

      if (outcome.ok) {
        if (!ipUnchanged) {
          this.deps.ipHistory.record({
            hostnameId: hostRow.id,
            recordType: target.recordType,
            previousIp: lastIp,
            newIp: target.ip,
            source: input.source,
            consensusJson: input.consensusJson ?? null,
            detectedAt: this.now().toISOString(),
          });
        }

        const ipv4 = target.recordType === "A" ? target.ip : hostRow.lastIpv4;
        const ipv6 = target.recordType === "AAAA" ? target.ip : hostRow.lastIpv6;
        db
          .update(hostnames)
          .set({
            lastIpv4: ipv4,
            lastIpv6: ipv6,
            lastUpdateAt: this.now().toISOString(),
            lastStatus: outcome.status,
            updatedAt: this.now().toISOString(),
          })
          .where(eq(hostnames.id, hostRow.id))
          .run();
        if (target.recordType === "A") hostRow.lastIpv4 = target.ip;
        else hostRow.lastIpv6 = target.ip;
        hostRow.lastUpdateAt = this.now().toISOString();
        hostRow.lastStatus = outcome.status;
      } else {
        db
          .update(hostnames)
          .set({
            lastStatus: `error:${outcome.status}`,
            updatedAt: this.now().toISOString(),
          })
          .where(eq(hostnames.id, hostRow.id))
          .run();
      }

      results.push({
        recordType: target.recordType,
        ip: target.ip,
        dispatched: true,
        ok: outcome.ok,
        status: outcome.ok ? "good" : outcome.status,
      });
    }

    return { hostname: hostRow.hostname, results };
  }

  private resolveTargets(
    recordType: string,
    ipv4: string | null | undefined,
    ipv6: string | null | undefined,
  ): Array<{ recordType: DnsRecordType; ip: string }> {
    const targets: Array<{ recordType: DnsRecordType; ip: string }> = [];
    const wantA = recordType === "A" || recordType === "BOTH";
    const wantAAAA = recordType === "AAAA" || recordType === "BOTH";
    if (wantA && ipv4 && isIPv4(ipv4)) targets.push({ recordType: "A", ip: ipv4 });
    if (wantAAAA && ipv6 && isIPv6(ipv6)) targets.push({ recordType: "AAAA", ip: ipv6 });
    return targets;
  }

  private writeLog(row: {
    hostnameId: number;
    source: UpdateSource;
    recordType: DnsRecordType;
    requestedIp: string | null;
    dispatched: boolean;
    ok: boolean;
    ipChanged: boolean;
    providerStatus: string;
    responseText: string;
    durationMs: number;
  }) {
    this.deps.db
      .insert(updateLogs)
      .values({
        hostnameId: row.hostnameId,
        source: row.source,
        recordType: row.recordType,
        requestedIp: row.requestedIp,
        dispatched: row.dispatched,
        ok: row.ok,
        ipChanged: row.ipChanged,
        providerStatus: row.providerStatus,
        responseText: row.responseText.slice(0, 1024),
        durationMs: row.durationMs,
      })
      .run();
  }
}

export class HostnameNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`hostname ${id} not found`);
    this.name = "HostnameNotFoundError";
  }
}
