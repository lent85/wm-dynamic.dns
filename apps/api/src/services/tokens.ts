import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { clientTokens, hostnames } from "../db/schema.js";
import { generateClientToken, hashToken } from "../crypto/tokens.js";

export interface CreateTokenInput {
  label: string;
  scopeHostnameIds: number[];
  expiresAt: string | null;
}

export class TokenService {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.select().from(clientTokens).all().map((row) => ({
      id: row.id,
      label: row.label,
      scopeHostnameIds: parseScope(row.scopeJson),
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      lastUsedIp: row.lastUsedIp,
      createdAt: row.createdAt,
    }));
  }

  create(input: CreateTokenInput): {
    plainToken: string;
    id: number;
    label: string;
    scopeHostnameIds: number[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    lastUsedIp: string | null;
    createdAt: string;
  } {
    if (input.scopeHostnameIds.length > 0) {
      const ids = new Set(input.scopeHostnameIds);
      const found = this.db.select({ id: hostnames.id }).from(hostnames).all();
      const known = new Set(found.map((r) => r.id));
      for (const id of ids) {
        if (!known.has(id)) throw new Error(`hostname ${id} does not exist`);
      }
    }
    const { plain, hash } = generateClientToken();
    const inserted = this.db
      .insert(clientTokens)
      .values({
        label: input.label,
        tokenHash: hash,
        scopeJson: JSON.stringify(input.scopeHostnameIds),
        expiresAt: input.expiresAt,
      })
      .returning()
      .get();
    return {
      plainToken: plain,
      id: inserted.id,
      label: inserted.label,
      scopeHostnameIds: parseScope(inserted.scopeJson),
      expiresAt: inserted.expiresAt,
      lastUsedAt: inserted.lastUsedAt,
      lastUsedIp: inserted.lastUsedIp,
      createdAt: inserted.createdAt,
    };
  }

  revoke(id: number): boolean {
    const res = this.db.delete(clientTokens).where(eq(clientTokens.id, id)).run();
    return res.changes > 0;
  }

  /**
   * Validates an incoming plaintext token. Returns the matching row + parsed
   * scope if the token is valid and not expired. Returns null otherwise.
   *
   * On success, also bumps `last_used_at` / `last_used_ip` (best-effort).
   */
  authenticate(plainToken: string, sourceIp: string | null): {
    id: number;
    scopeHostnameIds: number[];
  } | null {
    const hash = hashToken(plainToken);
    const row = this.db
      .select()
      .from(clientTokens)
      .where(eq(clientTokens.tokenHash, hash))
      .get();
    if (!row) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return null;

    this.db
      .update(clientTokens)
      .set({ lastUsedAt: new Date().toISOString(), lastUsedIp: sourceIp })
      .where(eq(clientTokens.id, row.id))
      .run();

    return { id: row.id, scopeHostnameIds: parseScope(row.scopeJson) };
  }
}

function parseScope(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number") : [];
  } catch {
    return [];
  }
}
