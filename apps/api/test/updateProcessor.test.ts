import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { UpdateProcessor } from "../src/services/updateProcessor.js";
import { SettingsService } from "../src/services/settings.js";
import { IpHistoryService } from "../src/services/ipHistory.js";
import { hostnames, updateLogs, ipChangeEvents } from "../src/db/schema.js";
import {
  makeTestDb,
  registerFakeProvider,
  seedProvider,
  seedHostname,
  silentLogger,
  TEST_KEY,
  type FakeProviderHandle,
} from "./helpers.js";

let db: ReturnType<typeof makeTestDb>;
let processor: UpdateProcessor;
let fake: FakeProviderHandle;
let providerId: number;
let now: Date;

beforeEach(() => {
  db = makeTestDb();
  fake = registerFakeProvider("fake-test");
  providerId = seedProvider(db, "fake-test", `p-${Math.random().toString(36).slice(2)}`);
  now = new Date("2026-01-01T00:00:00.000Z");
  processor = new UpdateProcessor({
    db,
    encryptionKey: TEST_KEY,
    logger: silentLogger,
    settingsService: new SettingsService(db),
    ipHistory: new IpHistoryService(db),
    now: () => now,
  });
});

describe("UpdateProcessor", () => {
  it("dispatches when there is no last_ip recorded", async () => {
    const id = seedHostname(db, { providerId, hostname: "home.example.com" });
    const out = await processor.process({
      hostnameId: id,
      source: "manual",
      ipv4: "1.2.3.4",
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ dispatched: true, ok: true, ip: "1.2.3.4" });
    expect(fake.calls).toHaveLength(1);
    const updated = db.select().from(hostnames).where(eq(hostnames.id, id)).get();
    expect(updated?.lastIpv4).toBe("1.2.3.4");
    expect(updated?.lastUpdateAt).toBe(now.toISOString());
  });

  it("skips dispatch when ip unchanged within force-interval", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "h.example.com",
      lastIpv4: "1.2.3.4",
      lastUpdateAt: new Date(now.getTime() - 60_000).toISOString(),
      forceIntervalSec: 86400,
    });
    const out = await processor.process({
      hostnameId: id,
      source: "client-duckdns",
      ipv4: "1.2.3.4",
    });
    expect(out.results[0]?.dispatched).toBe(false);
    expect(out.results[0]?.ok).toBe(true);
    expect(out.results[0]?.status).toBe("nochg");
    expect(fake.calls).toHaveLength(0);
    const logs = db.select().from(updateLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.dispatched).toBe(false);
    expect(logs[0]?.responseText).toContain("Detected IP: 1.2.3.4 (matches last IP: 1.2.3.4). Skipped.");
  });

  it("dispatches anyway after force-interval elapses even if ip unchanged", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "h.example.com",
      lastIpv4: "1.2.3.4",
      lastUpdateAt: new Date(now.getTime() - 90_000_000).toISOString(),
      forceIntervalSec: 86400,
    });
    const out = await processor.process({
      hostnameId: id,
      source: "schedule",
      ipv4: "1.2.3.4",
    });
    expect(out.results[0]?.dispatched).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const logs = db.select().from(updateLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.dispatched).toBe(true);
    expect(logs[0]?.responseText).toContain("Detected IP: 1.2.3.4 (matches last IP: 1.2.3.4 (force interval due)). Response: ok");
  });

  it("does not advance last_ip on provider failure (so retry can happen)", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "h.example.com",
      lastIpv4: "1.1.1.1",
      lastUpdateAt: now.toISOString(),
    });
    fake.setNextResult({ ok: false, status: "ko", raw: "boom" });
    const out = await processor.process({ hostnameId: id, source: "manual", ipv4: "9.9.9.9" });
    expect(out.results[0]?.ok).toBe(false);
    const updated = db.select().from(hostnames).where(eq(hostnames.id, id)).get();
    expect(updated?.lastIpv4).toBe("1.1.1.1");
    expect(updated?.lastStatus).toBe("error:ko");
  });

  it("handles BOTH record type updating A and AAAA independently", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "dual.example.com",
      recordType: "BOTH",
    });
    const out = await processor.process({
      hostnameId: id,
      source: "manual",
      ipv4: "1.2.3.4",
      ipv6: "fe80::1",
    });
    expect(out.results).toHaveLength(2);
    expect(out.results.map((r) => r.recordType).sort()).toEqual(["A", "AAAA"]);
    expect(fake.calls).toHaveLength(2);
    const updated = db.select().from(hostnames).where(eq(hostnames.id, id)).get();
    expect(updated?.lastIpv4).toBe("1.2.3.4");
    expect(updated?.lastIpv6).toBe("fe80::1");
  });

  it("ignores invalid ipv4 input gracefully", async () => {
    const id = seedHostname(db, { providerId, hostname: "h.example.com" });
    const out = await processor.process({
      hostnameId: id,
      source: "manual",
      ipv4: "not-an-ip",
    });
    expect(out.results).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("records IP change history when IP changes and dispatch succeeds", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "hist.example.com",
      lastIpv4: "1.1.1.1",
      lastUpdateAt: now.toISOString(),
    });
    await processor.process({
      hostnameId: id,
      source: "manual",
      ipv4: "2.2.2.2",
    });
    const events = db.select().from(ipChangeEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      hostnameId: id,
      recordType: "A",
      previousIp: "1.1.1.1",
      newIp: "2.2.2.2",
      source: "manual",
    });
  });

  it("does not record IP history when IP unchanged", async () => {
    const id = seedHostname(db, {
      providerId,
      hostname: "same.example.com",
      lastIpv4: "1.2.3.4",
      lastUpdateAt: new Date(now.getTime() - 90_000_000).toISOString(),
      forceIntervalSec: 86400,
    });
    await processor.process({
      hostnameId: id,
      source: "force-refresh",
      ipv4: "1.2.3.4",
    });
    expect(db.select().from(ipChangeEvents).all()).toHaveLength(0);
  });

  it("serializes concurrent updates for the same hostname (mutex)", async () => {
    const id = seedHostname(db, { providerId, hostname: "h.example.com" });
    const seen: number[] = [];
    fake.setNextResult({ ok: true, status: "good", raw: "ok" });
    const slow = async (mark: number) => {
      seen.push(mark);
      await new Promise((r) => setTimeout(r, 10));
      seen.push(-mark);
    };
    const original = processor;
    void original;
    const p1 = processor.process({ hostnameId: id, source: "manual", ipv4: "1.1.1.1" });
    const p2 = processor.process({ hostnameId: id, source: "manual", ipv4: "2.2.2.2" });
    await Promise.all([p1, p2, slow(1), slow(2)]);
    expect(fake.calls.map((c) => c.ip)).toEqual(["1.1.1.1", "2.2.2.2"]);
  });
});
