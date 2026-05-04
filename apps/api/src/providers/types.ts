import type { z } from "zod";
import type { ProviderTypeMeta } from "@wm-ddns/shared";

export type DnsRecordType = "A" | "AAAA";

export interface UpdateRecordArgs {
  config: unknown;
  hostname: string;
  recordType: DnsRecordType;
  ip: string;
  ttl: number;
  signal?: AbortSignal;
}

export interface UpdateRecordResult {
  ok: boolean;
  /** Short machine-readable status: "good", "nochg", "nohost", "badauth", ... */
  status: string;
  /** Raw response body (truncated by callers when logged) */
  raw: string;
}

export interface DnsProvider {
  /** Unique stable identifier; persisted in DB. */
  type: string;
  /** Static metadata used by the FE to render the config form. */
  meta: ProviderTypeMeta;
  /** Zod schema validating the config blob shape. */
  configSchema: z.ZodTypeAny;
  /** Push a single record update to the upstream provider. */
  updateRecord(args: UpdateRecordArgs): Promise<UpdateRecordResult>;
}
