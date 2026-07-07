import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  hostnameCreateRequestSchema,
  hostnameUpdateRequestSchema,
  forceUpdateRequestSchema,
  ipHistoryQuerySchema,
} from "@wm-ddns/shared";
import { HostnameError } from "../services/hostnames.js";
import { clientTokens } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function registerHostnameRoutes(app: FastifyInstance): Promise<void> {
  const { hostnames, scheduler, updateProcessor, publicIp, settings, ipHistory, tokens } =
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
        ipSourceUrl: parsed.data.ipSourceUrl ?? null,
        ipSourceDomain: parsed.data.ipSourceDomain ?? null,
        enabled: parsed.data.enabled,
      });

      // Associate existing tokens to this hostname (add hostnameId to their scopeJson)
      if (parsed.data.associatedTokenIds && parsed.data.associatedTokenIds.length > 0) {
        await linkTokensToHostname(app, parsed.data.associatedTokenIds, row.id);
      }

      // Optionally create a brand-new token scoped to just this hostname
      let newAssociatedToken: { plainToken: string; label: string } | undefined;
      if (parsed.data.createAssociatedTokenLabel) {
        const created = tokens.create({
          label: parsed.data.createAssociatedTokenLabel,
          scopeHostnameIds: [row.id],
          expiresAt: null,
        });
        newAssociatedToken = { plainToken: created.plainToken, label: created.label };
      }

      scheduler.syncHostnameTasks();
      return { ...row, newAssociatedToken };
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

      // Associate existing tokens (add hostnameId to their scopeJson)
      if (parsed.data.associatedTokenIds && parsed.data.associatedTokenIds.length > 0) {
        await linkTokensToHostname(app, parsed.data.associatedTokenIds, id);
      }

      // Create a new token scoped to this hostname
      let newAssociatedToken: { plainToken: string; label: string } | undefined;
      if (parsed.data.createAssociatedTokenLabel) {
        const created = tokens.create({
          label: parsed.data.createAssociatedTokenLabel,
          scopeHostnameIds: [id],
          expiresAt: null,
        });
        newAssociatedToken = { plainToken: created.plainToken, label: created.label };
      }

      scheduler.syncHostnameTasks();
      return { ...row, newAssociatedToken };
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

      if (!ipv4 && !ipv6) {
        // Auto-resolve based on the hostname's configured IP source.
        if (row.trackSelfIp || parsed.data.useSelfDetect) {
          const detected = await publicIp.detect(true);
          ipv4 = detected.ipv4;
          ipv6 = detected.ipv6;
          consensusJson = detected.consensus ? JSON.stringify(detected.consensus) : null;
        } else if (row.ipSourceUrl) {
          const res = await fetchIpFromUrl(row.ipSourceUrl);
          ipv4 = res.ipv4;
          ipv6 = res.ipv6;
        } else if (row.ipSourceDomain) {
          const res = await resolveIpFromDomain(row.ipSourceDomain);
          ipv4 = res.ipv4;
          ipv6 = res.ipv6;
        } else {
          // Token-push mode: no auto-detect, use last stored IP
          ipv4 = row.lastIpv4;
          ipv6 = row.lastIpv6;
        }
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

/**
 * Adds hostnameId to the scopeJson of each specified token (skipping tokens
 * that already include it, and skipping tokens with empty scope = "all").
 */
async function linkTokensToHostname(
  app: FastifyInstance,
  tokenIds: number[],
  hostnameId: number,
): Promise<void> {
  const db = app.appCtx.db;
  for (const tokenId of tokenIds) {
    const row = db.select().from(clientTokens).where(eq(clientTokens.id, tokenId)).get();
    if (!row) continue;
    let scope: number[];
    try {
      const parsed = JSON.parse(row.scopeJson);
      scope = Array.isArray(parsed) ? (parsed as number[]).filter((v) => typeof v === "number") : [];
    } catch {
      scope = [];
    }
    // Empty scope = all hostnames, no change needed
    if (scope.length === 0) continue;
    if (scope.includes(hostnameId)) continue;
    scope.push(hostnameId);
    db.update(clientTokens)
      .set({ scopeJson: JSON.stringify(scope) })
      .where(eq(clientTokens.id, tokenId))
      .run();
  }
}

const FETCH_TIMEOUT_MS = 5_000;

async function fetchIpFromUrl(
  url: string,
): Promise<{ ipv4: string | null; ipv6: string | null }> {
  try {
    const { classifyIp } = await import("../utils/ip.js");
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return { ipv4: null, ipv6: null };
    const text = (await res.text()).trim();
    const kind = classifyIp(text);
    if (kind === "ipv4") return { ipv4: text, ipv6: null };
    if (kind === "ipv6") return { ipv4: null, ipv6: text };
  } catch {
    /* ignore */
  }
  return { ipv4: null, ipv6: null };
}

async function resolveIpFromDomain(
  domain: string,
): Promise<{ ipv4: string | null; ipv6: string | null }> {
  const dns = await import("node:dns/promises");
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  try {
    const a = await dns.resolve4(domain);
    if (a && a.length > 0) ipv4 = a[0] ?? null;
  } catch { /* ignore */ }
  try {
    const aaaa = await dns.resolve6(domain);
    if (aaaa && aaaa.length > 0) ipv6 = aaaa[0] ?? null;
  } catch { /* ignore */ }
  return { ipv4, ipv6 };
}
