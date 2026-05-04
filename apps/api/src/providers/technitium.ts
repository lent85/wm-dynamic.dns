import { z } from "zod";
import type { DnsProvider, UpdateRecordArgs, UpdateRecordResult } from "./types.js";
import { providerFetch, truncate } from "./http.js";

const configSchema = z.object({
  baseUrl: z.string().url("baseUrl must be a valid URL like http://dns.example.com:5380"),
  apiToken: z.string().min(8, "API token is required"),
  /** Optional: explicit zone name. If empty, Technitium will auto-detect from domain. */
  zone: z.string().optional().default(""),
});

/**
 * Technitium DNS Server provider.
 *
 * Uses the upsert-style /api/zones/records/add with overwrite=true so that:
 *  - If no record exists, it is created.
 *  - If one or more records of the same type exist, they are replaced with
 *    the new IP. This makes the call idempotent and avoids the get/diff/add
 *    dance.
 *
 * API reference: https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md
 */
export const technitiumProvider: DnsProvider = {
  type: "technitium",
  meta: {
    type: "technitium",
    displayName: "Technitium DNS",
    description:
      "Self-hosted Technitium DNS Server. Requires an API token with permission on the target zone.",
    hostnameHint: "fully qualified domain name (e.g. home.example.com)",
    supportsIPv6: true,
    fields: [
      {
        name: "baseUrl",
        label: "Base URL",
        description: "Technitium HTTP web console URL, e.g. http://dns.example.com:5380",
        type: "url",
        required: true,
        placeholder: "http://dns.example.com:5380",
        secret: false,
      },
      {
        name: "apiToken",
        label: "API Token",
        description: "Permanent token created via Technitium > Administration > Sessions.",
        type: "password",
        required: true,
        secret: true,
      },
      {
        name: "zone",
        label: "Zone (optional)",
        description: "Leave empty to auto-detect from the hostname.",
        type: "string",
        required: false,
        placeholder: "example.com",
        secret: false,
      },
    ],
  },
  configSchema,
  async updateRecord(args: UpdateRecordArgs): Promise<UpdateRecordResult> {
    const cfg = configSchema.parse(args.config);
    const base = cfg.baseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/api/zones/records/add`);
    url.searchParams.set("token", cfg.apiToken);
    url.searchParams.set("domain", args.hostname);
    if (cfg.zone) url.searchParams.set("zone", cfg.zone);
    url.searchParams.set("type", args.recordType);
    url.searchParams.set("ipAddress", args.ip);
    url.searchParams.set("ttl", String(args.ttl));
    url.searchParams.set("overwrite", "true");

    let res;
    try {
      res = await providerFetch(url.toString(), { method: "POST", signal: args.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: "network_error", raw: msg };
    }

    let parsed: { status?: string; errorMessage?: string } | null = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      // not JSON; fall through
    }

    if (!res.ok) {
      return {
        ok: false,
        status: `http_${res.status}`,
        raw: truncate(res.body),
      };
    }

    if (parsed?.status === "ok") {
      return { ok: true, status: "good", raw: truncate(res.body) };
    }

    return {
      ok: false,
      status: parsed?.status ?? "error",
      raw: truncate(parsed?.errorMessage ?? res.body),
    };
  },
};
