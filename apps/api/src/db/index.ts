import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

export function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    const dir = path.dirname(path.resolve(file));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("temp_store = MEMORY");
  return drizzle(sqlite, { schema }) as Db;
}

export { schema };
