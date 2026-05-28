import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  hostnameCreateRequestSchema,
  hostnameUpdateRequestSchema,
  forceUpdateRequestSchema,
  ipHistoryQuerySchema,
} from "@wm-ddns/shared";
import { HostnameError } from "../services/hostnames.js";

export async function registerHostnameRoutes(app: FastifyInstance): Promise<void> {
  const { hostnames, scheduler, updateProcessor, publicIp, settings, ipHistory } =
    app.appCtx.services;

  app.get("/api/hostnames", { onRequest: [app.authenticate] }, async () => ({
    items: hostnames.list(),
  }));

  app.post("/api/hostnames", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = hostnameCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const appSettings = settings.get();
    try {
      const row = hostnames.create({
        hostname: parsed.data.hostname,
        providerId: parsed.data.providerId,
        recordType: parsed.data.recordType,
        ttl: parsed.data.ttl ?? appSettings.defaultTtl,
        forceIntervalSec:
          parsed.data.forceIntervalSec !== undefined ? parsed.data.forceIntervalSec : null,
        scheduleCron: parsed.data.scheduleCron ?? null,
        trackSelfIp: parsed.data.trackSelfIp,
        enabled: parsed.data.enabled,
      });
      scheduler.syncHostnameTasks();
      return row;
    } catch (err) {
      if (err instanceof HostnameError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/api/hostnames/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const row = hostnames.get(id);
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.get(
    "/api/hostnames/:id/ip-history",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { id } = parseIdParam(req.params);
      const row = hostnames.get(id);
      if (!row) return reply.code(404).send({ error: "not found" });
      const parsed = ipHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
      return ipHistory.listForHostname(id, parsed.data);
    },
  );

  app.put("/api/hostnames/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const parsed = hostnameUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const row = hostnames.update(id, parsed.data);
      if (!row) return reply.code(404).send({ error: "not found" });
      scheduler.syncHostnameTasks();
      return row;
    } catch (err) {
      if (err instanceof HostnameError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete("/api/hostnames/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const ok = hostnames.delete(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    scheduler.syncHostnameTasks();
    return { ok: true };
  });

  app.post(
    "/api/hostnames/:id/force-update",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { id } = parseIdParam(req.params);
      const parsed = forceUpdateRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const row = hostnames.get(id);
      if (!row) return reply.code(404).send({ error: "hostname not found" });

      let ipv4 = parsed.data.ipv4 ?? null;
      let ipv6 = parsed.data.ipv6 ?? null;
      let consensusJson: string | null = null;
      if (parsed.data.useSelfDetect || (!ipv4 && !ipv6)) {
        const detected = await publicIp.detect(true);
        ipv4 = ipv4 ?? detected.ipv4;
        ipv6 = ipv6 ?? detected.ipv6;
        consensusJson = detected.consensus ? JSON.stringify(detected.consensus) : null;
      }

      const out = await updateProcessor.process({
        hostnameId: id,
        source: "manual",
        ipv4,
        ipv6,
        consensusJson,
      });
      return out;
    },
  );
}

function parseIdParam(p: unknown): { id: number } {
  return z.object({ id: z.coerce.number().int() }).parse(p);
}
