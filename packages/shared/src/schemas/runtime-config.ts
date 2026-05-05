import { z } from "zod";

/** Keys persisted in `runtime-config.json` (partial overrides over `.env`). */
export const runtimeConfigFileSchema = z.object({
  jwtSecret: z.string().min(16, "JWT_SECRET must be at least 16 chars").optional(),
  appEncryptionKey: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .optional(),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  corsOrigin: z.string().optional(),
});

export type RuntimeConfigFile = z.infer<typeof runtimeConfigFileSchema>;

export const runtimeConfigUpdateRequestSchema = runtimeConfigFileSchema.partial().strict();
export type RuntimeConfigUpdateRequest = z.infer<typeof runtimeConfigUpdateRequestSchema>;

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/** GET /api/runtime-config — never returns raw secrets. */
export type RuntimeConfigPublic = {
  port: number;
  host: string;
  logLevel: LogLevel;
  corsOrigin: string | null;
  jwtSecretConfigured: boolean;
  encryptionKeyConfigured: boolean;
};

export type RuntimeConfigPutResponse = RuntimeConfigPublic & {
  needsRestart: boolean;
  needsRestartReasons: string[];
};
