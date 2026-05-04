import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { providers, hostnames } from "../db/schema.js";
import { encryptJSON, decryptJSON } from "../crypto/encrypt.js";
import { getProvider, listProviders } from "../providers/registry.js";

export interface ProviderRow {
  id: number;
  type: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class ProviderService {
  constructor(
    private readonly db: Db,
    private readonly encryptionKey: Buffer,
  ) {}

  listTypeMeta() {
    return listProviders().map((p) => p.meta);
  }

  list(): ProviderRow[] {
    const rows = this.db.select().from(providers).all();
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: this.maskConfig(r.type, this.tryDecrypt(r.configEnc)),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  get(id: number): ProviderRow | null {
    const r = this.db.select().from(providers).where(eq(providers.id, id)).get();
    if (!r) return null;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      config: this.maskConfig(r.type, this.tryDecrypt(r.configEnc)),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  create(input: { type: string; name: string; config: Record<string, unknown> }): ProviderRow {
    const plugin = getProvider(input.type);
    if (!plugin) throw new ProviderError(`unknown provider type: ${input.type}`, 400);
    const parsed = plugin.configSchema.safeParse(input.config);
    if (!parsed.success) {
      throw new ProviderError(`invalid provider config: ${parsed.error.message}`, 400);
    }
    const enc = encryptJSON(parsed.data, this.encryptionKey);
    try {
      const inserted = this.db
        .insert(providers)
        .values({ type: input.type, name: input.name, configEnc: enc })
        .returning()
        .get();
      return {
        id: inserted.id,
        type: inserted.type,
        name: inserted.name,
        config: this.maskConfig(inserted.type, parsed.data),
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      };
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new ProviderError(`provider name "${input.name}" already exists`, 409);
      }
      throw err;
    }
  }

  update(
    id: number,
    input: { name?: string; config?: Record<string, unknown> },
  ): ProviderRow | null {
    const existing = this.db.select().from(providers).where(eq(providers.id, id)).get();
    if (!existing) return null;

    const updates: { name?: string; configEnc?: string; updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };

    if (input.name !== undefined) updates.name = input.name;

    if (input.config !== undefined) {
      const plugin = getProvider(existing.type);
      if (!plugin) throw new ProviderError(`unknown provider type: ${existing.type}`, 400);
      const merged = mergeConfig(this.tryDecrypt(existing.configEnc), input.config);
      const parsed = plugin.configSchema.safeParse(merged);
      if (!parsed.success) {
        throw new ProviderError(`invalid provider config: ${parsed.error.message}`, 400);
      }
      updates.configEnc = encryptJSON(parsed.data, this.encryptionKey);
    }

    this.db.update(providers).set(updates).where(eq(providers.id, id)).run();
    return this.get(id);
  }

  delete(id: number): { ok: true } | { ok: false; reason: string } {
    const used = this.db
      .select({ id: hostnames.id })
      .from(hostnames)
      .where(eq(hostnames.providerId, id))
      .all();
    if (used.length > 0) {
      return {
        ok: false,
        reason: `provider is used by ${used.length} hostname(s); delete those first`,
      };
    }
    const res = this.db.delete(providers).where(eq(providers.id, id)).run();
    return res.changes > 0 ? { ok: true } : { ok: false, reason: "not found" };
  }

  /**
   * Returns the decrypted config for internal use (update processor).
   * Never expose this directly to the HTTP API.
   */
  getDecryptedConfig(id: number): { type: string; config: unknown } | null {
    const r = this.db.select().from(providers).where(eq(providers.id, id)).get();
    if (!r) return null;
    return { type: r.type, config: this.tryDecrypt(r.configEnc) };
  }

  private tryDecrypt(blob: string): Record<string, unknown> {
    try {
      return decryptJSON<Record<string, unknown>>(blob, this.encryptionKey);
    } catch {
      return {};
    }
  }

  private maskConfig(
    type: string,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const plugin = getProvider(type);
    if (!plugin) return { __error: "unknown provider type" };
    const masked: Record<string, unknown> = {};
    const secrets = new Set(plugin.meta.fields.filter((f) => f.secret).map((f) => f.name));
    for (const f of plugin.meta.fields) {
      if (secrets.has(f.name) && config[f.name]) {
        masked[f.name] = "********";
      } else {
        masked[f.name] = config[f.name] ?? null;
      }
    }
    return masked;
  }
}

function mergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === "********" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
