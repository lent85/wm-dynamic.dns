import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { hostnames, providers } from "../db/schema.js";
import { validateCron } from "../utils/cron.js";

export interface HostnameRow {
  id: number;
  hostname: string;
  providerId: number;
  providerName?: string;
  providerType?: string;
  recordType: string;
  ttl: number;
  forceIntervalSec: number;
  scheduleCron: string | null;
  trackSelfIp: boolean;
  enabled: boolean;
  lastIpv4: string | null;
  lastIpv6: string | null;
  lastUpdateAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export class HostnameService {
  constructor(
    private readonly db: Db,
    private readonly timezone: string,
  ) {}

  list(): HostnameRow[] {
    const rows = this.db
      .select({
        h: hostnames,
        providerName: providers.name,
        providerType: providers.type,
      })
      .from(hostnames)
      .innerJoin(providers, eq(hostnames.providerId, providers.id))
      .all();
    return rows.map(({ h, providerName, providerType }) => ({
      ...h,
      providerName,
      providerType,
    }));
  }

  get(id: number): HostnameRow | null {
    const r = this.db
      .select({
        h: hostnames,
        providerName: providers.name,
        providerType: providers.type,
      })
      .from(hostnames)
      .innerJoin(providers, eq(hostnames.providerId, providers.id))
      .where(eq(hostnames.id, id))
      .get();
    return r ? { ...r.h, providerName: r.providerName, providerType: r.providerType } : null;
  }

  findByName(hostname: string): HostnameRow | null {
    const r = this.db
      .select({
        h: hostnames,
        providerName: providers.name,
        providerType: providers.type,
      })
      .from(hostnames)
      .innerJoin(providers, eq(hostnames.providerId, providers.id))
      .where(eq(hostnames.hostname, hostname))
      .get();
    return r ? { ...r.h, providerName: r.providerName, providerType: r.providerType } : null;
  }

  create(input: {
    hostname: string;
    providerId: number;
    recordType: "A" | "AAAA" | "BOTH";
    ttl: number;
    forceIntervalSec: number;
    scheduleCron: string | null;
    trackSelfIp: boolean;
    enabled: boolean;
  }): HostnameRow {
    const provider = this.db
      .select()
      .from(providers)
      .where(eq(providers.id, input.providerId))
      .get();
    if (!provider) throw new HostnameError("provider does not exist", 400);

    if (input.scheduleCron) {
      const check = validateCron(input.scheduleCron, { tz: this.timezone });
      if (!check.valid) throw new HostnameError(`invalid cron: ${check.error}`, 400);
    }

    try {
      const inserted = this.db
        .insert(hostnames)
        .values({
          hostname: input.hostname,
          providerId: input.providerId,
          recordType: input.recordType,
          ttl: input.ttl,
          forceIntervalSec: input.forceIntervalSec,
          scheduleCron: input.scheduleCron,
          trackSelfIp: input.trackSelfIp,
          enabled: input.enabled,
        })
        .returning()
        .get();
      return { ...inserted, providerName: provider.name, providerType: provider.type };
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new HostnameError(`hostname "${input.hostname}" already exists`, 409);
      }
      throw err;
    }
  }

  update(
    id: number,
    input: Partial<{
      hostname: string;
      providerId: number;
      recordType: "A" | "AAAA" | "BOTH";
      ttl: number;
      forceIntervalSec: number;
      scheduleCron: string | null;
      trackSelfIp: boolean;
      enabled: boolean;
    }>,
  ): HostnameRow | null {
    const existing = this.db.select().from(hostnames).where(eq(hostnames.id, id)).get();
    if (!existing) return null;

    if (input.providerId !== undefined && input.providerId !== existing.providerId) {
      const p = this.db
        .select()
        .from(providers)
        .where(eq(providers.id, input.providerId))
        .get();
      if (!p) throw new HostnameError("provider does not exist", 400);
    }

    if (input.scheduleCron) {
      const check = validateCron(input.scheduleCron, { tz: this.timezone });
      if (!check.valid) throw new HostnameError(`invalid cron: ${check.error}`, 400);
    }

    this.db
      .update(hostnames)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(hostnames.id, id))
      .run();

    return this.get(id);
  }

  delete(id: number): boolean {
    const res = this.db.delete(hostnames).where(eq(hostnames.id, id)).run();
    return res.changes > 0;
  }

  listScheduled(): Array<HostnameRow & { scheduleCron: string }> {
    return this.list().filter(
      (h): h is HostnameRow & { scheduleCron: string } =>
        h.enabled && typeof h.scheduleCron === "string" && h.scheduleCron.trim() !== "",
    );
  }

  listSelfTracked(): HostnameRow[] {
    return this.list().filter((h) => h.enabled && h.trackSelfIp);
  }
}

export class HostnameError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "HostnameError";
  }
}
