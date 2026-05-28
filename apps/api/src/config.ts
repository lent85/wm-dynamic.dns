import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runtimeConfigFileSchema } from "@wm-ddns/shared";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  RUNTIME_CONFIG_PATH: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),
  ADMIN_USER: z.string().min(1).optional(),
  ADMIN_PASS: z.string().min(8).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().optional(),
  PUBLIC_IP_PROVIDERS: z
    .string()
    .default("https://api.ipify.org,https://ifconfig.co/ip,https://icanhazip.com"),
  SELF_DETECT_INTERVAL_SEC: z.coerce.number().int().min(0).default(300),
  DEFAULT_FORCE_INTERVAL_SEC: z.coerce.number().int().min(60).max(604800).default(3600),
  TZ: z.string().default("UTC"),
});

export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  host: string;
  trustProxy: boolean;
  databaseFile: string;
  /** Absolute path used for atomic read/write of runtime overrides. */
  runtimeConfigPath: string;
  jwtSecret: string;
  encryptionKey: Buffer;
  adminUser: string | undefined;
  adminPass: string | undefined;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  corsOrigin: string | undefined;
  publicIpProviders: string[];
  selfDetectIntervalSec: number;
  defaultForceIntervalSec: number;
  timezone: string;
};

export function resolveRuntimeConfigPath(databaseFile: string, envOverride?: string): string {
  if (envOverride?.trim()) return path.resolve(envOverride.trim());
  const dir = path.dirname(path.resolve(databaseFile));
  return path.join(dir, "runtime-config.json");
}

export function readRuntimeConfigFile(filePath: string): z.infer<typeof runtimeConfigFileSchema> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const parsed = runtimeConfigFileSchema.safeParse(raw);
    if (!parsed.success) return {};
    return parsed.data;
  } catch {
    return {};
  }
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const env = parsed.data;
  const dbFile = env.DATABASE_URL.startsWith("file:")
    ? env.DATABASE_URL.slice("file:".length)
    : env.DATABASE_URL;
  const runtimeConfigPath = resolveRuntimeConfigPath(dbFile, env.RUNTIME_CONFIG_PATH);
  const rc = readRuntimeConfigFile(runtimeConfigPath);

  const jwtSecret = rc.jwtSecret ?? env.JWT_SECRET;
  const appEnc = rc.appEncryptionKey ?? env.APP_ENCRYPTION_KEY;
  const logLevel = rc.logLevel ?? env.LOG_LEVEL;
  const corsOriginRaw = rc.corsOrigin !== undefined ? rc.corsOrigin : env.CORS_ORIGIN;
  const corsOrigin = corsOriginRaw?.trim() ? corsOriginRaw.trim() : undefined;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    trustProxy: env.TRUST_PROXY,
    databaseFile: dbFile,
    runtimeConfigPath,
    jwtSecret,
    encryptionKey: Buffer.from(appEnc, "hex"),
    adminUser: env.ADMIN_USER,
    adminPass: env.ADMIN_PASS,
    logLevel,
    corsOrigin,
    publicIpProviders: env.PUBLIC_IP_PROVIDERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    selfDetectIntervalSec: env.SELF_DETECT_INTERVAL_SEC,
    defaultForceIntervalSec: env.DEFAULT_FORCE_INTERVAL_SEC,
    timezone: env.TZ,
  };
}
