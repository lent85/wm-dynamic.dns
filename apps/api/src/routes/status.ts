import type { FastifyInstance } from "fastify";
import { hostnames as hostnamesTable, providers as providersTable, clientTokens } from "../db/schema.js";
import { count } from "drizzle-orm";

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  const { settings, publicIp } = app.appCtx.services;
  const { db, startedAt } = app.appCtx;

  app.get("/api/status", { onRequest: [app.authenticate] }, async () => {
    const [hCount] = db.select({ c: count() }).from(hostnamesTable).all();
    const [pCount] = db.select({ c: count() }).from(providersTable).all();
    const [tCount] = db.select({ c: count() }).from(clientTokens).all();
    const ip = publicIp.snapshot();
    const cfg = settings.get();
    return {
      hostnames: hCount?.c ?? 0,
      providers: pCount?.c ?? 0,
      tokens: tCount?.c ?? 0,
      selfIpv4: ip.ipv4,
      selfIpv6: ip.ipv6,
      selfIpFetchedAt: ip.fetchedAt ? ip.fetchedAt.toISOString() : null,
      selfDetectIntervalSec: cfg.selfDetectIntervalSec,
      uptimeSec: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      version: app.appCtx.config.nodeEnv === "production" ? "0.1.0" : "0.1.0-dev",
    };
  });
}
