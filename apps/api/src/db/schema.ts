import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const providers = sqliteTable(
  "providers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    /** AES-256-GCM ciphertext (base64) of the JSON config */
    configEnc: text("config_enc").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    nameUnique: uniqueIndex("providers_name_unique").on(t.name),
  }),
);

export const hostnames = sqliteTable(
  "hostnames",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostname: text("hostname").notNull(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    /** "A" | "AAAA" | "BOTH" */
    recordType: text("record_type").notNull().default("A"),
    ttl: integer("ttl").notNull().default(300),
    /** null = inherit global defaultForceIntervalSec */
    forceIntervalSec: integer("force_interval_sec"),
    /** Cron expression in IANA timezone of TZ env. Null = no schedule. */
    scheduleCron: text("schedule_cron"),
    trackSelfIp: integer("track_self_ip", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastIpv4: text("last_ipv4"),
    lastIpv6: text("last_ipv6"),
    lastUpdateAt: text("last_update_at"),
    lastStatus: text("last_status"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    hostnameUnique: uniqueIndex("hostnames_hostname_unique").on(t.hostname),
    providerIdx: index("hostnames_provider_idx").on(t.providerId),
  }),
);

export const clientTokens = sqliteTable(
  "client_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    /** SHA-256 hex hash of the plaintext token */
    tokenHash: text("token_hash").notNull(),
    /** JSON array of hostname ids this token may update. Empty array = all. */
    scopeJson: text("scope_json").notNull().default("[]"),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("client_tokens_hash_unique").on(t.tokenHash),
  }),
);

export const updateLogs = sqliteTable(
  "update_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostnameId: integer("hostname_id").references(() => hostnames.id, {
      onDelete: "cascade",
    }),
    source: text("source").notNull(),
    recordType: text("record_type").notNull(),
    requestedIp: text("requested_ip"),
    dispatched: integer("dispatched", { mode: "boolean" }).notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    providerStatus: text("provider_status"),
    responseText: text("response_text"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    hostnameIdx: index("update_logs_hostname_idx").on(t.hostnameId, t.createdAt),
    createdIdx: index("update_logs_created_idx").on(t.createdAt),
  }),
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const ipChangeEvents = sqliteTable(
  "ip_change_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostnameId: integer("hostname_id")
      .notNull()
      .references(() => hostnames.id, { onDelete: "cascade" }),
    recordType: text("record_type").notNull(),
    previousIp: text("previous_ip"),
    newIp: text("new_ip").notNull(),
    source: text("source").notNull(),
    consensusJson: text("consensus_json"),
    detectedAt: text("detected_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    hostnameDetectedIdx: index("ip_change_events_hostname_detected_idx").on(
      t.hostnameId,
      t.detectedAt,
    ),
  }),
);

export const adminAudit = sqliteTable(
  "admin_audit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: integer("target_id"),
    metaJson: text("meta_json"),
    ip: text("ip"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    actionIdx: index("admin_audit_action_idx").on(t.action, t.createdAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Hostname = typeof hostnames.$inferSelect;
export type ClientToken = typeof clientTokens.$inferSelect;
export type UpdateLog = typeof updateLogs.$inferSelect;
export type IpChangeEvent = typeof ipChangeEvents.$inferSelect;
export type Setting = typeof settings.$inferSelect;
