import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  providerCreateRequestSchema,
  providerUpdateRequestSchema,
} from "@wm-ddns/shared";
import { ProviderError } from "../services/providers.js";

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  const { providers } = app.appCtx.services;

  app.get("/api/providers/types", { onRequest: [app.authenticate] }, async () => ({
    items: providers.listTypeMeta(),
  }));

  app.get("/api/providers", { onRequest: [app.authenticate] }, async () => ({
    items: providers.list(),
  }));

  app.post("/api/providers", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = providerCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return providers.create(parsed.data);
    } catch (err) {
      if (err instanceof ProviderError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/api/providers/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const row = providers.get(id);
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.put("/api/providers/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const parsed = providerUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const updated = providers.update(id, parsed.data);
      if (!updated) return reply.code(404).send({ error: "not found" });
      return updated;
    } catch (err) {
      if (err instanceof ProviderError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete("/api/providers/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = parseIdParam(req.params);
    const result = providers.delete(id);
    if (!result.ok) {
      const code = result.reason === "not found" ? 404 : 409;
      return reply.code(code).send({ error: result.reason });
    }
    return { ok: true };
  });
}

function parseIdParam(p: unknown): { id: number } {
  return z.object({ id: z.coerce.number().int() }).parse(p);
}
