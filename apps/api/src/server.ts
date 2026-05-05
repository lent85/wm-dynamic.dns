import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySensible from "@fastify/sensible";
import fastifyFormbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { AuthService } from "./services/auth.js";
import { ProviderService } from "./services/providers.js";
import { HostnameService } from "./services/hostnames.js";
import { TokenService } from "./services/tokens.js";
import { LogService } from "./services/logs.js";
import { SettingsService } from "./services/settings.js";
import { PublicIpService } from "./services/publicIp.js";
import { UpdateProcessor } from "./services/updateProcessor.js";
import { Scheduler } from "./services/scheduler.js";
import type { AppContext } from "./app-context.js";

import { registerPublicRoutes } from "./routes/public.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerHostnameRoutes } from "./routes/hostnames.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRuntimeConfigRoutes } from "./routes/runtime-config.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      req: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: number; username: string };
    user: { id: number; username: string };
  }
}

export interface BuildServerOptions {
  config: AppConfig;
  logger: FastifyBaseLogger;
}

export async function buildServer(opts: BuildServerOptions): Promise<{
  app: FastifyInstance;
  ctx: AppContext;
}> {
  const { config, logger } = opts;

  const db = openDatabase(config.databaseFile);
  const { applied } = runMigrations(db);
  if (applied.length > 0) {
    logger.info({ applied }, "applied migrations");
  }

  const authService = new AuthService(db);
  const providerService = new ProviderService(db, config.encryptionKey);
  const hostnameService = new HostnameService(db, config.timezone);
  const tokenService = new TokenService(db);
  const logService = new LogService(db);
  const settingsService = new SettingsService(db);
  const publicIpService = new PublicIpService(config.publicIpProviders, logger);
  const updateProcessor = new UpdateProcessor({
    db,
    encryptionKey: config.encryptionKey,
    logger,
  });
  const scheduler = new Scheduler({
    hostnameService,
    updateProcessor,
    publicIpService,
    settingsService,
    logger,
    timezone: config.timezone,
    selfDetectIntervalSec: config.selfDetectIntervalSec,
  });

  const initialSettings = settingsService.get();
  if (initialSettings.publicIpProviders.length > 0) {
    publicIpService.setProviders(initialSettings.publicIpProviders);
  }

  if (config.adminUser && config.adminPass && !(await authService.hasAnyUser())) {
    await authService.createUser(config.adminUser, config.adminPass);
    logger.info({ username: config.adminUser }, "seeded initial admin user from env");
  }

  const ctx: AppContext = {
    config,
    logger,
    db,
    startedAt: new Date(),
    services: {
      auth: authService,
      providers: providerService,
      hostnames: hostnameService,
      tokens: tokenService,
      logs: logService,
      settings: settingsService,
      publicIp: publicIpService,
      updateProcessor,
      scheduler,
    },
  };

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    disableRequestLogging: config.nodeEnv === "production",
    bodyLimit: 256 * 1024,
  });

  app.decorate("appCtx", ctx);

  await app.register(fastifySensible);
  await app.register(fastifyFormbody);

  if (config.corsOrigin) {
    await app.register(fastifyCors, {
      origin: config.corsOrigin.split(",").map((s) => s.trim()),
      credentials: true,
    });
  }

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: "7d" },
  });

  app.decorate(
    "authenticate",
    async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      try {
        const payload = await req.jwtVerify<{ sub: number; username: string }>();
        req.user = { id: payload.sub, username: payload.username };
      } catch {
        reply.code(401).send({ error: "unauthorized" });
      }
    },
  );

  await app.register(fastifyRateLimit, {
    global: false,
  });

  // Apply rate-limit selectively to public client endpoints.
  await app.register(async (instance) => {
    await instance.register(fastifyRateLimit, {
      max: 60,
      timeWindow: "1 minute",
      keyGenerator: (req) => {
        const auth = req.headers["authorization"] ?? "";
        const tokenQ = (req.query as { token?: string } | undefined)?.token ?? "";
        return `${req.ip}:${auth.slice(0, 32)}:${tokenQ.slice(0, 16)}`;
      },
    });
    await registerPublicRoutes(instance);
  });

  await registerAuthRoutes(app);
  await registerProviderRoutes(app);
  await registerHostnameRoutes(app);
  await registerTokenRoutes(app);
  await registerLogRoutes(app);
  await registerStatusRoutes(app);
  await registerSettingsRoutes(app);
  await registerRuntimeConfigRoutes(app);

  await registerStaticSpa(app, config);

  app.addHook("onClose", async () => {
    scheduler.stop();
    db.$client.close();
  });

  return { app, ctx };
}

async function registerStaticSpa(app: FastifyInstance, config: AppConfig): Promise<void> {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // Resolution targets for the SPA bundle, in priority order:
  //  - dev (tsx):     apps/api/src/server.ts          → ../../web/dist
  //  - api build:     apps/api/dist/server.js         → ../../web/dist (same)
  //  - docker prod:   /app/dist/main.js               → ../apps/web/dist
  //                                                  → ../web/dist (legacy)
  const candidates = [
    path.resolve(here, "../../web/dist"),
    path.resolve(here, "../apps/web/dist"),
    path.resolve(here, "../web/dist"),
    path.resolve(here, "../../../web/dist"),
    path.resolve(here, "../../../apps/web/dist"),
  ];
  const root = candidates.find((p) => fs.existsSync(p));
  if (!root) {
    if (config.nodeEnv === "production") {
      app.log.warn(
        { tried: candidates },
        "frontend bundle not found; admin UI will not be served",
      );
    }
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: false,
  });
  // SPA fallback: any non-API GET that did not match a file falls back to index.html
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === "GET" &&
      !req.url.startsWith("/api") &&
      !req.url.startsWith("/update") &&
      !req.url.startsWith("/nic/") &&
      !req.url.startsWith("/healthz")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });
}
