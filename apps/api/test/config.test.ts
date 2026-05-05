import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig + runtime-config.json", () => {
  const prevEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-ddns-cfg-"));
  });

  afterEach(() => {
    process.env = { ...prevEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges runtime file overrides for logLevel", () => {
    const dbFile = path.join(tmpDir, "app.db");
    const rcPath = path.join(tmpDir, "runtime-config.json");
    fs.writeFileSync(rcPath, JSON.stringify({ logLevel: "debug" }));

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.RUNTIME_CONFIG_PATH = rcPath;
    process.env.JWT_SECRET = "x".repeat(16);
    process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
    process.env.LOG_LEVEL = "info";

    const cfg = loadConfig();
    expect(cfg.logLevel).toBe("debug");
    expect(path.resolve(cfg.runtimeConfigPath)).toBe(path.resolve(rcPath));
  });

  it("defaults runtime path beside database file when RUNTIME_CONFIG_PATH unset", () => {
    const dbFile = path.join(tmpDir, "nested", "app.db");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.writeFileSync(dbFile, "");

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = `file:${dbFile}`;
    delete process.env.RUNTIME_CONFIG_PATH;
    process.env.JWT_SECRET = "x".repeat(16);
    process.env.APP_ENCRYPTION_KEY = "a".repeat(64);

    const cfg = loadConfig();
    expect(cfg.runtimeConfigPath).toBe(
      path.join(path.dirname(path.resolve(dbFile)), "runtime-config.json"),
    );
  });
});
