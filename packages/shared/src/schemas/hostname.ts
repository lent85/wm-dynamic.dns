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
  trackSelfIp: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type HostnameCreateRequest = z.infer<typeof hostnameCreateRequestSchema>;

export const hostnameUpdateRequestSchema = hostnameCreateRequestSchema.partial();
export type HostnameUpdateRequest = z.infer<typeof hostnameUpdateRequestSchema>;

export const forceUpdateRequestSchema = z.object({
  ipv4: z.string().ip({ version: "v4" }).optional(),
  ipv6: z.string().ip({ version: "v6" }).optional(),
  useSelfDetect: z.boolean().default(false),
});

export type ForceUpdateRequest = z.infer<typeof forceUpdateRequestSchema>;
