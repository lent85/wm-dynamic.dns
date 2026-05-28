import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicIpService } from "../src/services/publicIp.js";

const logger = { warn: vi.fn() };

describe("PublicIpService", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("v4")) {
          return { ok: true, text: async () => "203.0.113.1" };
        }
        if (url.includes("bad")) {
          return { ok: false, text: async () => "" };
        }
        return { ok: true, text: async () => "203.0.113.1" };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("consensus picks IP with enough agreements", async () => {
    const svc = new PublicIpService(
      ["https://a.example/v4", "https://b.example/v4", "https://c.example/v4"],
      logger,
    );
    svc.applySettings({ publicIpDetectionMode: "consensus", publicIpMinAgreements: 2 });
    const snap = await svc.detect(true);
    expect(snap.ipv4).toBe("203.0.113.1");
    expect(snap.consensus?.ipv4Votes["203.0.113.1"]).toBeGreaterThanOrEqual(2);
  });

  it("failover returns first good IP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("first-bad")) return { ok: false, text: async () => "" };
        return { ok: true, text: async () => "198.51.100.2" };
      }),
    );
    const svc = new PublicIpService(
      ["https://first-bad.example", "https://good.example"],
      logger,
    );
    svc.applySettings({ publicIpDetectionMode: "failover", publicIpMinAgreements: 2 });
    const snap = await svc.detect(true);
    expect(snap.ipv4).toBe("198.51.100.2");
  });
});
