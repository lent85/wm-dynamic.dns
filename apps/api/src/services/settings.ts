import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { settings } from "../db/schema.js";
import {
  type AppSettings,
  appSettingsSchema,
  defaultPublicIpServices,
  type PublicIpServiceConfig,
} from "@wm-ddns/shared";

const SETTINGS_KEY = "app";

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly bootstrap: Partial<AppSettings> = {},
  ) {}

  get(): AppSettings {
    const row = this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    let stored: Record<string, unknown> = {};
    if (row) {
      try {
        stored = JSON.parse(row.value) as Record<string, unknown>;
      } catch {
        stored = {};
      }
    }
    const migrated = migrateLegacyPublicIpProviders(stored);
    return appSettingsSchema.parse({ ...this.bootstrap, ...migrated });
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const next = appSettingsSchema.parse({ ...current, ...patch });
    const value = JSON.stringify(next);
    const existing = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .get();
    if (existing) {
      this.db
        .update(settings)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(eq(settings.key, SETTINGS_KEY))
        .run();
    } else {
      this.db.insert(settings).values({ key: SETTINGS_KEY, value }).run();
    }
    return next;
  }
}

function migrateLegacyPublicIpProviders(stored: Record<string, unknown>): Record<string, unknown> {
  const hasNewField =
    Array.isArray(stored.publicIpServices) && (stored.publicIpServices as unknown[]).length > 0;
  if (hasNewField) return stored;

  const legacy = Array.isArray(stored.publicIpProviders) ? stored.publicIpProviders : [];
  const urls = legacy
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  if (urls.length === 0) return stored;

  const mapped: PublicIpServiceConfig[] = urls.map((url, idx) => ({
    id: `legacy-${idx + 1}`,
    name: `Legacy provider ${idx + 1}`,
    url,
    enabled: true,
  }));
  return {
    ...stored,
    publicIpServices: mapped.length > 0 ? mapped : defaultPublicIpServices,
  };
}
