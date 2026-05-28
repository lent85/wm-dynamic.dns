import { z } from "zod";

export const publicIpDetectionModeSchema = z.enum(["failover", "consensus"]);
export type PublicIpDetectionMode = z.infer<typeof publicIpDetectionModeSchema>;

export const publicIpServiceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});
export type PublicIpServiceConfig = z.infer<typeof publicIpServiceConfigSchema>;

export const defaultPublicIpServices: PublicIpServiceConfig[] = [
  { id: "ipify", name: "ipify", url: "https://api.ipify.org", enabled: true },
  { id: "ifconfig", name: "ifconfig.co", url: "https://ifconfig.co/ip", enabled: true },
  { id: "icanhazip", name: "icanhazip", url: "https://icanhazip.com", enabled: true },
];

export const appSettingsSchema = z.object({
  defaultForceIntervalSec: z.number().int().min(60).max(604800).default(3600),
  defaultTtl: z.number().int().min(30).max(86400).default(300),
  selfDetectEnabled: z.boolean().default(true),
  selfDetectIntervalSec: z.number().int().min(60).max(86400).default(300),
  publicIpServices: z.array(publicIpServiceConfigSchema).min(1).default(defaultPublicIpServices),
  publicIpDetectionMode: publicIpDetectionModeSchema.default("consensus"),
  publicIpMinAgreements: z.number().int().min(2).max(10).default(2),
  ipHistoryRetentionDays: z.number().int().min(1).max(3650).default(90),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsUpdateRequestSchema = appSettingsSchema.partial();
export type AppSettingsUpdateRequest = z.infer<typeof appSettingsUpdateRequestSchema>;

export function getEnabledPublicIpProviderUrls(settings: Pick<AppSettings, "publicIpServices">): string[] {
  return settings.publicIpServices
    .filter((svc) => svc.enabled)
    .map((svc) => svc.url.trim())
    .filter(Boolean);
}
