import type { FastifyInstance } from "fastify";
import pino from "pino";
import {
  runtimeConfigUpdateRequestSchema,
  type RuntimeConfigPutResponse,
  type RuntimeConfigPublic,
} from "@wm-ddns/shared";
import { loadConfig } from "../config.js";
import { writeRuntimeConfigPatch } from "../services/runtimeConfigPersist.js";

function toPublicFromConfig(cfg: {
  port: number;
  host: string;
  logLevel: RuntimeConfigPublic["logLevel"];
  corsOrigin: string | undefined;
  jwtSecret: string;
  encryptionKey: Buffer;
}): RuntimeConfigPublic {
  return {
    port: cfg.port,
    host: cfg.host,
    logLevel: cfg.logLevel,
    corsOrigin: cfg.corsOrigin ?? null,
    jwtSecretConfigured: cfg.jwtSecret.length >= 16,
    encryptionKeyConfigured: cfg.encryptionKey.length === 32,
  };
}

export async function registerRuntimeConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/runtime-config", { onRequest: [app.authenticate] }, async () => {
    const cfg = loadConfig();
    return toPublicFromConfig(cfg) satisfies RuntimeConfigPublic;
  });

  app.put("/api/runtime-config", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = runtimeConfigUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const ctx = app.appCtx;
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      const cfg = loadConfig();
      const pub = toPublicFromConfig(cfg);
      return { ...pub, needsRestart: false, needsRestartReasons: [] } satisfies RuntimeConfigPutResponse;
    }

    writeRuntimeConfigPatch(ctx.config.runtimeConfigPath, patch);
    const refreshed = loadConfig();

    const reasons: string[] = [];
    if (patch.jwtSecret !== undefined) reasons.push("JWT secret");
    if (patch.appEncryptionKey !== undefined) reasons.push("Encryption key");
    if (patch.corsOrigin !== undefined) reasons.push("CORS");

    ctx.config.logLevel = refreshed.logLevel;
    const rootLogger = ctx.logger as pino.Logger;
    rootLogger.level = refreshed.logLevel;
    ctx.config.corsOrigin = refreshed.corsOrigin;

    if (patch.jwtSecret === undefined) ctx.config.jwtSecret = refreshed.jwtSecret;
    if (patch.appEncryptionKey === undefined) ctx.config.encryptionKey = refreshed.encryptionKey;

    const needsRestart = reasons.length > 0;
    const pub = toPublicFromConfig(ctx.config);
    return { ...pub, needsRestart, needsRestartReasons: reasons } satisfies RuntimeConfigPutResponse;
  });
}
