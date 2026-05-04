import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clientTokenCreateRequestSchema } from "@wm-ddns/shared";

export async function registerTokenRoutes(app: FastifyInstance): Promise<void> {
  const { tokens } = app.appCtx.services;

  app.get("/api/tokens", { onRequest: [app.authenticate] }, async () => ({
    items: tokens.list(),
  }));

  app.post("/api/tokens", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = clientTokenCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return tokens.create(parsed.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed to create token";
      return reply.code(400).send({ error: msg });
    }
  });

  app.delete("/api/tokens/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const ok = tokens.revoke(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
