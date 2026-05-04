import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLogger } from "../src/logger.js";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";
import { registerFakeProvider, type FakeProviderHandle } from "./helpers.js";

let app: FastifyInstance;
let fake: FakeProviderHandle;
let plainToken: string;
let hostnameId: number;

beforeAll(async () => {
  fake = registerFakeProvider("e2e-fake");
  const config: AppConfig = {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    trustProxy: true,
    databaseFile: ":memory:",
    jwtSecret: "test-secret-test-secret-test-secret",
    encryptionKey: Buffer.alloc(32, 0xab),
    adminUser: "admin",
    adminPass: "test-pass-1234",
    logLevel: "fatal",
    corsOrigin: undefined,
    publicIpProviders: [],
    selfDetectIntervalSec: 0,
    timezone: "UTC",
  };
  const logger = createLogger(config);
  const built = await buildServer({ config, logger });
  app = built.app;

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-pass-1234" },
  });
  expect(login.statusCode).toBe(200);
  const jwt = JSON.parse(login.body).token as string;

  const provider = await app.inject({
    method: "POST",
    url: "/api/providers",
    headers: { authorization: `Bearer ${jwt}` },
    payload: { type: "e2e-fake", name: "e2e-provider", config: { secret: "shh" } },
  });
  expect(provider.statusCode).toBe(200);
  const providerId = JSON.parse(provider.body).id as number;

  const host = await app.inject({
    method: "POST",
    url: "/api/hostnames",
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      hostname: "home.example.com",
      providerId,
      recordType: "A",
      ttl: 300,
      forceIntervalSec: 86400,
    },
  });
  expect(host.statusCode).toBe(200);
  hostnameId = JSON.parse(host.body).id as number;

  const tokenRes = await app.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${jwt}` },
    payload: { label: "test-token", scopeHostnameIds: [hostnameId], expiresAt: null },
  });
  expect(tokenRes.statusCode).toBe(200);
  plainToken = JSON.parse(tokenRes.body).plainToken as string;
});

afterAll(async () => {
  await app.close();
});

describe("Public DDNS endpoints", () => {
  it("DuckDNS-compat /update returns OK on first dispatch", async () => {
    fake.calls.length = 0;
    fake.setNextResult({ ok: true, status: "good", raw: "OK" });
    const res = await app.inject({
      method: "GET",
      url: `/update?token=${plainToken}&domains=home.example.com&ip=8.8.8.8`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.startsWith("OK")).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.ip).toBe("8.8.8.8");
  });

  it("DuckDNS-compat /update returns nochg when ip is unchanged", async () => {
    fake.calls.length = 0;
    const res = await app.inject({
      method: "GET",
      url: `/update?token=${plainToken}&domains=home.example.com&ip=8.8.8.8`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("nochg");
    expect(fake.calls).toHaveLength(0);
  });

  it("DuckDNS-compat /update rejects bad token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/update?token=wmd_invalid&domains=home.example.com&ip=8.8.8.8`,
    });
    expect(res.body).toContain("KO");
  });

  it("dyndns2-compat /nic/update with Basic Auth dispatches", async () => {
    fake.calls.length = 0;
    fake.setNextResult({ ok: true, status: "good", raw: "OK" });
    const auth = Buffer.from(`user:${plainToken}`).toString("base64");
    const res = await app.inject({
      method: "GET",
      url: `/nic/update?hostname=home.example.com&myip=4.4.4.4`,
      headers: { authorization: `Basic ${auth}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("good 4.4.4.4");
  });

  it("dyndns2-compat /nic/update returns nochg when same ip", async () => {
    const auth = Buffer.from(`user:${plainToken}`).toString("base64");
    const res = await app.inject({
      method: "GET",
      url: `/nic/update?hostname=home.example.com&myip=4.4.4.4`,
      headers: { authorization: `Basic ${auth}` },
    });
    expect(res.body).toBe("nochg 4.4.4.4");
  });

  it("dyndns2-compat /nic/update returns badauth on missing creds", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/nic/update?hostname=home.example.com&myip=4.4.4.4`,
    });
    expect(res.body).toBe("badauth");
  });
});
