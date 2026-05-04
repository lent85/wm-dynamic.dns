import { z } from "zod";

export const statusResponseSchema = z.object({
  hostnames: z.number().int(),
  providers: z.number().int(),
  tokens: z.number().int(),
  selfIpv4: z.string().nullable(),
  selfIpv6: z.string().nullable(),
  selfIpFetchedAt: z.string().nullable(),
  selfDetectIntervalSec: z.number().int(),
  uptimeSec: z.number().int(),
  version: z.string(),
});

export type StatusResponse = z.infer<typeof statusResponseSchema>;
