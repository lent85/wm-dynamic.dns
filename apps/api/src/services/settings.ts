import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { type AppSettings, appSettingsSchema } from "@wm-ddns/shared";

const SETTINGS_KEY = "app";

export class SettingsService {
  constructor(private readonly db: Db) {}

  get(): AppSettings {
    const row = this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    if (!row) return appSettingsSchema.parse({});
    try {
      return appSettingsSchema.parse(JSON.parse(row.value));
    } catch {
      return appSettingsSchema.parse({});
    }
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
