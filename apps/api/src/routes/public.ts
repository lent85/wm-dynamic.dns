import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { UpdateSource } from "@wm-ddns/shared";
import { classifyIp, normalizeRemoteIp } from "../utils/ip.js";

/**
 * Public DDNS-compatible client endpoints.
 *
 * These routes are deliberately permissive about content-types and
 * response formats: they are designed to be called by curl one-liners,
 * Synology DDNS clients, mobile DDNS apps, etc.
 */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  const { tokens, hostnames, updateProcessor } = app.appCtx.services;

  app.get("/healthz", async (_req, reply) => {
    try {
      // Touch the DB so we report unhealthy if the file is unreadable.
      app.appCtx.db.$client.prepare("SELECT 1").get();
      reply.type("text/plain").send("ok");
    } catch (err) {
      app.log.error({ err }, "healthcheck failed");
      reply.code(503).type("text/plain").send("unhealthy");
    }
  });

  // ---------------- DuckDNS-compatible: GET /update ---------------------
  const duckUpdateQuery = z.object({
    token: z.string().min(1),
    domains: z.string().min(1),
    ip: z.string().optional(),
    ipv6: z.string().optional(),
  });

  app.get("/update", async (req, reply) => {
    const parsed = duckUpdateQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.type("text/plain").send("KO\nbad request");
    }
    const { token, domains, ip, ipv6 } = parsed.data;
    const sourceIp = normalizeRemoteIp(req.ip);
    const auth = tokens.authenticate(token, sourceIp);
    if (!auth) {
      return reply.type("text/plain").send("KO\nbad auth");
    }

    const ipv4 = (() => {
      if (!ip || ip === "auto") {
        return sourceIp && classifyIp(sourceIp) === "ipv4" ? sourceIp : null;
      }
      return classifyIp(ip) === "ipv4" ? ip : null;
    })();
    const ipv6Resolved = (() => {
      if (ipv6) return classifyIp(ipv6) === "ipv6" ? ipv6 : null;
      if (ip && classifyIp(ip) === "ipv6") return ip;
      if (sourceIp && classifyIp(sourceIp) === "ipv6" && (!ip || ip === "auto")) return sourceIp;
      return null;
    })();

    const requested = domains.split(",").map((s) => s.trim()).filter(Boolean);
    if (requested.length === 0) {
      return reply.type("text/plain").send("KO\nno domains");
    }

    const allowed = filterByScope(requested, auth.scopeHostnameIds, hostnames);
    if (allowed.length === 0) {
      return reply.type("text/plain").send("KO\nno authorized domains");
    }

    const lines: string[] = [];
    let anyChange = false;

    for (const h of allowed) {
      try {
        const out = await updateProcessor.process({
          hostnameId: h.id,
          source: "client-duckdns" as UpdateSource,
          ipv4,
          ipv6: ipv6Resolved,
        });
        for (const r of out.results) {
          if (r.dispatched && r.ok) anyChange = true;
        }
        lines.push(formatDuckLine(h.hostname, out.results));
      } catch (err) {
        app.log.error({ err, hostname: h.hostname }, "duckdns-compat update failed");
        lines.push(`KO ${h.hostname}`);
      }
    }

    const head = anyChange ? "OK" : lines.every((l) => l.startsWith("OK")) ? "OK" : "KO";
    return reply.type("text/plain").send(`${head}\n${lines.join("\n")}`);
  });

  // ---------------- DynDNS2-compatible: GET /nic/update ----------------
  // Authenticated via HTTP Basic Auth. Username is ignored, password = token.
  app.get("/nic/update", async (req, reply) => {
    const tokenStr = extractBasicAuthToken(req);
    if (!tokenStr) return reply.type("text/plain").send("badauth");

    const sourceIp = normalizeRemoteIp(req.ip);
    const auth = tokens.authenticate(tokenStr, sourceIp);
    if (!auth) return reply.type("text/plain").send("badauth");

    const q = z
      .object({
        hostname: z.string().min(1),
        myip: z.string().optional(),
        myipv6: z.string().optional(),
      })
      .safeParse(req.query);
    if (!q.success) return reply.type("text/plain").send("badagent");

    const { hostname: hostnamesCsv, myip, myipv6 } = q.data;

    const ipv4 = (() => {
      if (!myip) return sourceIp && classifyIp(sourceIp) === "ipv4" ? sourceIp : null;
      return classifyIp(myip) === "ipv4" ? myip : null;
    })();
    const ipv6Resolved = (() => {
      if (myipv6) return classifyIp(myipv6) === "ipv6" ? myipv6 : null;
      if (myip && classifyIp(myip) === "ipv6") return myip;
      return null;
    })();

    const requested = hostnamesCsv.split(",").map((s) => s.trim()).filter(Boolean);
    const allowed = filterByScope(requested, auth.scopeHostnameIds, hostnames);
    if (allowed.length === 0) return reply.type("text/plain").send("nohost");

    const lines: string[] = [];
    for (const h of allowed) {
      try {
        const out = await updateProcessor.process({
          hostnameId: h.id,
          source: "client-dyndns2" as UpdateSource,
          ipv4,
          ipv6: ipv6Resolved,
        });
        lines.push(formatDyndns2Line(out.results));
      } catch (err) {
        app.log.error({ err, hostname: h.hostname }, "dyndns2 update failed");
        lines.push("911");
      }
    }
    return reply.type("text/plain").send(lines.join("\n"));
  });
}

function filterByScope(
  requestedNames: string[],
  scopeIds: number[],
  hostnameSvc: import("../services/hostnames.js").HostnameService,
) {
  const list = hostnameSvc.list().filter((h) => h.enabled);
  const byName = new Map(list.map((h) => [h.hostname, h]));
  // Allow short DuckDNS-style "subdomain" → "subdomain.duckdns.org" matching
  for (const h of list) {
    if (h.hostname.endsWith(".duckdns.org")) {
      byName.set(h.hostname.replace(/\.duckdns\.org$/, ""), h);
    }
  }
  const scopeSet = new Set(scopeIds);
  const allowAll = scopeIds.length === 0;
  return requestedNames
    .map((n) => byName.get(n))
    .filter((h): h is NonNullable<typeof h> => !!h && (allowAll || scopeSet.has(h.id)));
}

function extractBasicAuthToken(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (!h || !h.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return decoded.slice(idx + 1) || null;
  } catch {
    return null;
  }
}

function formatDuckLine(
  hostname: string,
  results: Array<{ dispatched: boolean; ok: boolean; ip: string }>,
): string {
  if (results.length === 0) return `OK ${hostname} no-op`;
  const allOk = results.every((r) => r.ok);
  const ips = results.map((r) => r.ip).join(",");
  if (!allOk) return `KO ${hostname}`;
  const dispatched = results.some((r) => r.dispatched);
  return `OK ${hostname} ${dispatched ? "changed" : "nochg"} ${ips}`;
}

function formatDyndns2Line(
  results: Array<{ recordType: "A" | "AAAA"; dispatched: boolean; ok: boolean; ip: string }>,
): string {
  if (results.length === 0) return "nochg";
  if (!results.every((r) => r.ok)) return "911";
  const ipv4 = results.find((r) => r.recordType === "A");
  const primary = ipv4 ?? results[0]!;
  return primary.dispatched ? `good ${primary.ip}` : `nochg ${primary.ip}`;
}
