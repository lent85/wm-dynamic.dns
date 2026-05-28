import type { Db } from "./index.js";

/**
 * Lightweight bootstrap migration runner.
 *
 * We embed CREATE TABLE statements directly instead of using drizzle-kit
 * migrations because the schema is small and the project ships as a single
 * Docker image; this avoids shipping migration SQL files at runtime and keeps
 * the on-disk DB self-creating on first boot.
 *
 * To evolve the schema:
 *   1. Edit schema.ts (Drizzle types).
 *   2. Append a new migration entry below; never edit a previous one.
 *   3. Bump SCHEMA_VERSION (if you want a hard guard).
 */

type Migration = {
  id: string;
  up: (db: Db) => void;
};

const migrations: Migration[] = [
  {
    id: "0001_init",
    up: (db) => {
      const sqlite = db.$client;
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          config_enc TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS providers_name_unique ON providers(name);

        CREATE TABLE IF NOT EXISTS hostnames (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname TEXT NOT NULL,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
          record_type TEXT NOT NULL DEFAULT 'A',
          ttl INTEGER NOT NULL DEFAULT 300,
          force_interval_sec INTEGER NOT NULL DEFAULT 86400,
          schedule_cron TEXT,
          track_self_ip INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_ipv4 TEXT,
          last_ipv6 TEXT,
          last_update_at TEXT,
          last_status TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS hostnames_hostname_unique ON hostnames(hostname);
        CREATE INDEX IF NOT EXISTS hostnames_provider_idx ON hostnames(provider_id);

        CREATE TABLE IF NOT EXISTS client_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          scope_json TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT,
          last_used_at TEXT,
          last_used_ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS client_tokens_hash_unique ON client_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS update_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname_id INTEGER REFERENCES hostnames(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          record_type TEXT NOT NULL,
          requested_ip TEXT,
          dispatched INTEGER NOT NULL,
          ok INTEGER NOT NULL,
          provider_status TEXT,
          response_text TEXT,
          duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS update_logs_hostname_idx ON update_logs(hostname_id, created_at);
        CREATE INDEX IF NOT EXISTS update_logs_created_idx ON update_logs(created_at);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS admin_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id INTEGER,
          meta_json TEXT,
          ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit(action, created_at);

        CREATE TABLE IF NOT EXISTS _migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: "0002_force_interval_nullable_ip_history",
    up: (db) => {
      const sqlite = db.$client;
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS ip_change_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname_id INTEGER NOT NULL REFERENCES hostnames(id) ON DELETE CASCADE,
          record_type TEXT NOT NULL,
          previous_ip TEXT,
          new_ip TEXT NOT NULL,
          source TEXT NOT NULL,
          consensus_json TEXT,
          detected_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ip_change_events_hostname_detected_idx
          ON ip_change_events(hostname_id, detected_at);
      `);

      const cols = sqlite
        .prepare("PRAGMA table_info(hostnames)")
        .all() as Array<{ name: string; notnull: number }>;
      const forceCol = cols.find((c) => c.name === "force_interval_sec");
      if (forceCol && forceCol.notnull === 1) {
        sqlite.exec(`
          CREATE TABLE hostnames_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hostname TEXT NOT NULL,
            provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
            record_type TEXT NOT NULL DEFAULT 'A',
            ttl INTEGER NOT NULL DEFAULT 300,
            force_interval_sec INTEGER,
            schedule_cron TEXT,
            track_self_ip INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_ipv4 TEXT,
            last_ipv6 TEXT,
            last_update_at TEXT,
            last_status TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO hostnames_new (
            id, hostname, provider_id, record_type, ttl, force_interval_sec,
            schedule_cron, track_self_ip, enabled, last_ipv4, last_ipv6,
            last_update_at, last_status, created_at, updated_at
          )
          SELECT
            id, hostname, provider_id, record_type, ttl, force_interval_sec,
            schedule_cron, track_self_ip, enabled, last_ipv4, last_ipv6,
            last_update_at, last_status, created_at, updated_at
          FROM hostnames;
          DROP TABLE hostnames;
          ALTER TABLE hostnames_new RENAME TO hostnames;
          CREATE UNIQUE INDEX IF NOT EXISTS hostnames_hostname_unique ON hostnames(hostname);
          CREATE INDEX IF NOT EXISTS hostnames_provider_idx ON hostnames(provider_id);
        `);
      }
    },
  },
];

export function runMigrations(db: Db): { applied: string[] } {
  const sqlite = db.$client;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied: string[] = [];
  const getApplied = sqlite.prepare<[string], { id: string }>(
    "SELECT id FROM _migrations WHERE id = ?",
  );
  const insertApplied = sqlite.prepare<[string]>("INSERT INTO _migrations (id) VALUES (?)");

  for (const m of migrations) {
    if (getApplied.get(m.id)) continue;
    const txn = sqlite.transaction(() => {
      m.up(db);
      insertApplied.run(m.id);
    });
    txn();
    applied.push(m.id);
  }
  return { applied };
}
