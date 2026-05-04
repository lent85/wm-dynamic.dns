import { z } from "zod";

export const appSettingsSchema = z.object({
  defaultForceIntervalSec: z.number().int().min(0).default(86400),
  defaultTtl: z.number().int().min(30).max(86400).default(300),
  selfDetectEnabled: z.boolean().default(true),
  selfDetectIntervalSec: z.number().int().min(60).max(86400).default(300),
  publicIpProviders: z.array(z.string().url()).default([]),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsUpdateRequestSchema = appSettingsSchema.partial();
export type AppSettingsUpdateRequest = z.infer<typeof appSettingsUpdateRequestSchema>;
