import type { FastifyInstance } from "fastify";
import { updateLogQuerySchema } from "@wm-ddns/shared";

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  const { logs } = app.appCtx.services;

  app.get("/api/logs", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = updateLogQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return logs.query(parsed.data);
  });
}
