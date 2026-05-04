import type { FastifyInstance } from "fastify";
import {
  loginRequestSchema,
  changePasswordRequestSchema,
  initialSetupRequestSchema,
} from "@wm-ddns/shared";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { auth } = app.appCtx.services;

  app.get("/api/auth/setup-status", async () => ({
    needsSetup: !(await auth.hasAnyUser()),
  }));

  app.post("/api/auth/setup", async (req, reply) => {
    if (await auth.hasAnyUser()) {
      return reply.code(409).send({ error: "already initialized" });
    }
    const parsed = initialSetupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const user = await auth.createUser(parsed.data.username, parsed.data.password);
    const token = await reply.jwtSign({ sub: user.id, username: user.username });
    return { token, user };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const user = await auth.verify(parsed.data.username, parsed.data.password);
    if (!user) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = await reply.jwtSign({ sub: user.id, username: user.username });
    return { token, user };
  });

  app.get("/api/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    return { user: req.user };
  });

  app.post(
    "/api/auth/change-password",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const parsed = changePasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const ok = await auth.changePassword(
        req.user!.id,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      if (!ok) return reply.code(403).send({ error: "current password incorrect" });
      return { ok: true };
    },
  );
}
