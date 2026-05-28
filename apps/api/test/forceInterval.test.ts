import { describe, it, expect } from "vitest";
import { isForceDue, resolveForceIntervalSec } from "../src/utils/forceInterval.js";
import { appSettingsSchema } from "@wm-ddns/shared";

describe("forceInterval utils", () => {
  const settings = appSettingsSchema.parse({ defaultForceIntervalSec: 3600 });

  it("inherits global default when hostname value is null", () => {
    expect(resolveForceIntervalSec(null, settings)).toBe(3600);
  });

  it("uses hostname override when set", () => {
    expect(resolveForceIntervalSec(7200, settings)).toBe(7200);
  });

  it("uses env fallback when global default absent in settings object", () => {
    expect(resolveForceIntervalSec(null, {} as ReturnType<typeof appSettingsSchema.parse>, 1800)).toBe(
      1800,
    );
  });

  it("force due when never updated", () => {
    expect(isForceDue(null, 3600, new Date())).toBe(true);
  });

  it("not force due within interval", () => {
    const now = new Date("2026-01-01T02:00:00Z");
    const last = "2026-01-01T01:30:00.000Z";
    expect(isForceDue(last, 3600, now)).toBe(false);
  });

  it("force due after interval elapsed", () => {
    const now = new Date("2026-01-01T03:00:00Z");
    const last = "2026-01-01T01:00:00.000Z";
    expect(isForceDue(last, 3600, now)).toBe(true);
  });

  it("force disabled when interval is 0", () => {
    expect(isForceDue(null, 0, new Date())).toBe(false);
  });
});
