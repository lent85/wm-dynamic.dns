import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appSettingsUpdateRequestSchema, getEnabledPublicIpProviderUrls } from "@wm-ddns/shared";
import { validateCron } from "../utils/cron.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const { settings, publicIp, scheduler } = app.appCtx.services;

  app.get("/api/settings", { onRequest: [app.authenticate] }, async () => settings.get());

  app.put("/api/settings", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = appSettingsUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const next = settings.update(parsed.data);
    publicIp.setProviders(getEnabledPublicIpProviderUrls(next));
    scheduler.reloadFromSettings();
    return next;
  });

  app.post("/api/cron/validate", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = z
      .object({ expr: z.string().min(1), tz: z.string().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const tz = parsed.data.tz ?? app.appCtx.config.timezone;
    return validateCron(parsed.data.expr, { tz, samples: 5 });
  });
}
