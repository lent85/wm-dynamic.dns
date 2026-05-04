import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
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
  TZ: z.string().default("UTC"),
});

export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  host: string;
  trustProxy: boolean;
  databaseFile: string;
  jwtSecret: string;
  encryptionKey: Buffer;
  adminUser: string | undefined;
  adminPass: string | undefined;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  corsOrigin: string | undefined;
  publicIpProviders: string[];
  selfDetectIntervalSec: number;
  timezone: string;
};

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
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    trustProxy: env.TRUST_PROXY,
    databaseFile: dbFile,
    jwtSecret: env.JWT_SECRET,
    encryptionKey: Buffer.from(env.APP_ENCRYPTION_KEY, "hex"),
    adminUser: env.ADMIN_USER,
    adminPass: env.ADMIN_PASS,
    logLevel: env.LOG_LEVEL,
    corsOrigin: env.CORS_ORIGIN || undefined,
    publicIpProviders: env.PUBLIC_IP_PROVIDERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    selfDetectIntervalSec: env.SELF_DETECT_INTERVAL_SEC,
    timezone: env.TZ,
  };
}
