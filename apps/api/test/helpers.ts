import { openDatabase, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { encryptJSON } from "../src/crypto/encrypt.js";
import { providers, hostnames } from "../src/db/schema.js";
import { registerProvider } from "../src/providers/registry.js";
import type { DnsProvider, UpdateRecordArgs, UpdateRecordResult } from "../src/providers/types.js";
import { z } from "zod";

export const TEST_KEY = Buffer.alloc(32, 0x42);

export function makeTestDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

export interface FakeProviderHandle {
  type: string;
  calls: Array<{
    hostname: string;
    recordType: "A" | "AAAA";
    ip: string;
    ttl: number;
  }>;
  setNextResult(r: UpdateRecordResult): void;
  setNextError(err: Error): void;
}

export function registerFakeProvider(type = "fake"): FakeProviderHandle {
  const calls: FakeProviderHandle["calls"] = [];
  let nextResult: UpdateRecordResult = { ok: true, status: "good", raw: "ok" };
  let nextError: Error | null = null;

  const plugin: DnsProvider = {
    type,
    meta: {
      type,
      displayName: "Fake",
      description: "Test provider",
      hostnameHint: "anything",
      supportsIPv6: true,
      fields: [
        { name: "secret", label: "Secret", type: "password", required: true, secret: true },
      ],
    },
    configSchema: z.object({ secret: z.string() }),
    async updateRecord(args: UpdateRecordArgs): Promise<UpdateRecordResult> {
      calls.push({
        hostname: args.hostname,
        recordType: args.recordType,
        ip: args.ip,
        ttl: args.ttl,
      });
      if (nextError) {
        const e = nextError;
        nextError = null;
        throw e;
      }
      return nextResult;
    },
  };
  registerProvider(plugin);
  return {
    type,
    calls,
    setNextResult: (r) => {
      nextResult = r;
    },
    setNextError: (err) => {
      nextError = err;
    },
  };
}

export function seedProvider(db: Db, type: string, name = "test-provider"): number {
  const inserted = db
    .insert(providers)
    .values({
      type,
      name,
      configEnc: encryptJSON({ secret: "shh" }, TEST_KEY),
    })
    .returning()
    .get();
  return inserted.id;
}

export function seedHostname(
  db: Db,
  opts: {
    providerId: number;
    hostname: string;
    recordType?: "A" | "AAAA" | "BOTH";
    forceIntervalSec?: number | null;
    lastIpv4?: string | null;
    lastIpv6?: string | null;
    lastUpdateAt?: string | null;
  },
): number {
  const inserted = db
    .insert(hostnames)
    .values({
      hostname: opts.hostname,
      providerId: opts.providerId,
      recordType: opts.recordType ?? "A",
      ttl: 300,
      forceIntervalSec: opts.forceIntervalSec !== undefined ? opts.forceIntervalSec : null,
      lastIpv4: opts.lastIpv4 ?? null,
      lastIpv6: opts.lastIpv6 ?? null,
      lastUpdateAt: opts.lastUpdateAt ?? null,
      enabled: true,
      trackSelfIp: false,
    })
    .returning()
    .get();
  return inserted.id;
}

export const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
} as unknown as import("fastify").FastifyBaseLogger;
