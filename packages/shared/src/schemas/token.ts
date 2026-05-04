import { z } from "zod";

export const clientTokenSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  scopeHostnameIds: z.array(z.number().int()),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  createdAt: z.string(),
});

export type ClientToken = z.infer<typeof clientTokenSchema>;

export const clientTokenCreateRequestSchema = z.object({
  label: z.string().min(1).max(128),
  scopeHostnameIds: z.array(z.number().int()).default([]),
  expiresAt: z.string().datetime().nullable().default(null),
});

export type ClientTokenCreateRequest = z.infer<typeof clientTokenCreateRequestSchema>;

export const clientTokenCreateResponseSchema = clientTokenSchema.extend({
  // Plain text token, returned only once at creation time.
  plainToken: z.string(),
});

export type ClientTokenCreateResponse = z.infer<typeof clientTokenCreateResponseSchema>;
