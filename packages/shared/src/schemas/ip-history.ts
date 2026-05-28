import { z } from "zod";
import { updateSourceSchema } from "./log.js";

export const ipChangeEventSchema = z.object({
  id: z.number().int(),
  hostnameId: z.number().int(),
  recordType: z.enum(["A", "AAAA"]),
  previousIp: z.string().nullable(),
  newIp: z.string(),
  source: updateSourceSchema,
  detectedAt: z.string(),
  consensusJson: z.string().nullable().optional(),
});

export type IpChangeEvent = z.infer<typeof ipChangeEventSchema>;

export const ipHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.coerce.number().int().optional(),
});

export type IpHistoryQuery = z.infer<typeof ipHistoryQuerySchema>;

export const ipHistoryPageSchema = z.object({
  items: z.array(ipChangeEventSchema),
  nextCursor: z.number().int().nullable(),
});

export type IpHistoryPage = z.infer<typeof ipHistoryPageSchema>;
