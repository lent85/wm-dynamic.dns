import { z } from "zod";

export const recordTypeSchema = z.enum(["A", "AAAA", "BOTH"]);
export type RecordType = z.infer<typeof recordTypeSchema>;

export const recentIpChangeSchema = z.object({
  id: z.number().int(),
  recordType: z.enum(["A", "AAAA"]),
  previousIp: z.string().nullable(),
  newIp: z.string(),
  detectedAt: z.string(),
});

export type RecentIpChange = z.infer<typeof recentIpChangeSchema>;

export const hostnameSchema = z.object({
  id: z.number().int(),
  hostname: z.string(),
  providerId: z.number().int(),
  providerName: z.string().optional(),
  providerType: z.string().optional(),
  recordType: recordTypeSchema,
  ttl: z.number().int().min(30).max(86400),
  /** null = inherit global defaultForceIntervalSec */
  forceIntervalSec: z.number().int().min(0).nullable(),
  scheduleCron: z.string().nullable(),
  trackSelfIp: z.boolean(),
  /** Pull IP from this URL (e.g. https://api.ipify.org). Used when trackSelfIp=false. */
  ipSourceUrl: z.string().nullable().optional(),
  /** Resolve A/AAAA of this domain to get the IP. Used when trackSelfIp=false. */
  ipSourceDomain: z.string().nullable().optional(),
  enabled: z.boolean(),
  lastIpv4: z.string().nullable(),
  lastIpv6: z.string().nullable(),
  lastUpdateAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  recentIpHistory: z.array(recentIpChangeSchema).optional(),
});

export type Hostname = z.infer<typeof hostnameSchema>;

export const hostnameCreateRequestSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, digits, dot, dash, underscore are allowed"),
  providerId: z.number().int(),
  recordType: recordTypeSchema.default("A"),
  ttl: z.number().int().min(30).max(86400).optional(),
  /** Omit or null to inherit global default */
  forceIntervalSec: z.number().int().min(0).nullable().optional(),
  scheduleCron: z.string().nullable().default(null),
  /** Defaults to true so new hostnames immediately track the server's own public IP. */
  trackSelfIp: z.boolean().default(true),
  /** Custom URL to pull the current public IP from. Only used when trackSelfIp=false. */
  ipSourceUrl: z.string().nullable().optional(),
  /** Domain whose DNS A/AAAA is resolved to get the current IP. Only used when trackSelfIp=false. */
  ipSourceDomain: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  /**
   * IDs of existing client tokens to associate (add this hostname to their scope).
   * Used when trackSelfIp=false and the update mode is "push via token".
   */
  associatedTokenIds: z.array(z.number().int()).optional(),
  /**
   * If provided, create a new client token with this label scoped to this hostname.
   * The plain token value will be returned in the response as `newAssociatedToken`.
   */
  createAssociatedTokenLabel: z.string().optional(),
});

export type HostnameCreateRequest = z.infer<typeof hostnameCreateRequestSchema>;

export const hostnameUpdateRequestSchema = hostnameCreateRequestSchema
  .omit({ createAssociatedTokenLabel: true })
  .extend({
    /** Same as create — generate a new token scoped to this hostname. */
    createAssociatedTokenLabel: z.string().optional(),
  })
  .partial();
export type HostnameUpdateRequest = z.infer<typeof hostnameUpdateRequestSchema>;

export const forceUpdateRequestSchema = z.object({
  ipv4: z.string().ip({ version: "v4" }).optional(),
  ipv6: z.string().ip({ version: "v6" }).optional(),
  useSelfDetect: z.boolean().default(false),
});

export type ForceUpdateRequest = z.infer<typeof forceUpdateRequestSchema>;
