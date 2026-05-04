import { z } from "zod";
import type { DnsProvider, UpdateRecordArgs, UpdateRecordResult } from "./types.js";
import { providerFetch, truncate } from "./http.js";

const configSchema = z.object({
  token: z.string().min(8, "DuckDNS token is required"),
});

export const duckdnsProvider: DnsProvider = {
  type: "duckdns",
  meta: {
    type: "duckdns",
    displayName: "DuckDNS",
    description:
      "Free DDNS at duckdns.org. Hostname must be the bare subdomain (e.g. 'home') or fully qualified (e.g. 'home.duckdns.org').",
    hostnameHint: "subdomain or subdomain.duckdns.org",
    supportsIPv6: true,
    fields: [
      {
        name: "token",
        label: "DuckDNS Token",
        description: "Your DuckDNS account token (UUID).",
        type: "password",
        required: true,
        secret: true,
      },
    ],
  },
  configSchema,
  async updateRecord(args: UpdateRecordArgs): Promise<UpdateRecordResult> {
    const cfg = configSchema.parse(args.config);

    let subdomain = args.hostname;
    if (subdomain.endsWith(".duckdns.org")) {
      subdomain = subdomain.slice(0, -".duckdns.org".length);
    }
    if (!subdomain) {
      return { ok: false, status: "badhost", raw: "empty subdomain" };
    }

    const url = new URL("https://www.duckdns.org/update");
    url.searchParams.set("domains", subdomain);
    url.searchParams.set("token", cfg.token);
    url.searchParams.set("verbose", "true");
    if (args.recordType === "AAAA") {
      url.searchParams.set("ipv6", args.ip);
      // ip param empty so DuckDNS does not touch the A record
      url.searchParams.set("ip", "");
    } else {
      url.searchParams.set("ip", args.ip);
    }

    let res;
    try {
      res = await providerFetch(url.toString(), { signal: args.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: "network_error", raw: msg };
    }

    const body = res.body.trim();
    const firstLine = body.split(/\r?\n/)[0]?.trim();
    if (!res.ok || firstLine !== "OK") {
      return { ok: false, status: firstLine === "KO" ? "ko" : "http_error", raw: truncate(body) };
    }
    return { ok: true, status: "good", raw: truncate(body) };
  },
};
