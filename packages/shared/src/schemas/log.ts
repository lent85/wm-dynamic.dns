import { z } from "zod";

export const updateSourceSchema = z.enum([
  "client-duckdns",
  "client-dyndns2",
  "schedule",
  "self-detect",
  "manual",
  "force-refresh",
]);

export type UpdateSource = z.infer<typeof updateSourceSchema>;

export const updateLogSchema = z.object({
  id: z.number().int(),
  hostnameId: z.number().int(),
  hostname: z.string().optional(),
  source: updateSourceSchema,
  recordType: z.enum(["A", "AAAA"]),
  requestedIp: z.string().nullable(),
  dispatched: z.boolean(),
  ok: z.boolean(),
  providerStatus: z.string().nullable(),
  responseText: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
});

export type UpdateLog = z.infer<typeof updateLogSchema>;

export const updateLogQuerySchema = z.object({
  hostnameId: z.coerce.number().int().optional(),
  source: updateSourceSchema.optional(),
  ok: z.coerce.boolean().optional(),
  dispatched: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.coerce.number().int().optional(),
});

export type UpdateLogQuery = z.infer<typeof updateLogQuerySchema>;

export const updateLogPageSchema = z.object({
  items: z.array(updateLogSchema),
  nextCursor: z.number().int().nullable(),
});

export type UpdateLogPage = z.infer<typeof updateLogPageSchema>;
