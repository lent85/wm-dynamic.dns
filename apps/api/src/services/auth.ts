import { eq } from "drizzle-orm";
import argon2 from "argon2";
import type { Db } from "../db/index.js";
import { users } from "../db/schema.js";

export class AuthService {
  constructor(private readonly db: Db) {}

  async hasAnyUser(): Promise<boolean> {
    const r = this.db.select({ id: users.id }).from(users).limit(1).all();
    return r.length > 0;
  }

  async createUser(username: string, password: string): Promise<{ id: number; username: string }> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      const inserted = this.db
        .insert(users)
        .values({ username, passwordHash })
        .returning()
        .get();
      return { id: inserted.id, username: inserted.username };
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new AuthError("username already exists", 409);
      }
      throw err;
    }
  }

  async verify(username: string, password: string): Promise<{ id: number; username: string } | null> {
    const row = this.db.select().from(users).where(eq(users.username, username)).get();
    if (!row) {
      // Constant-time-ish: still hash a dummy to slow brute force.
      await argon2.verify(
        "$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXkAAAAAAAAA$IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
        password,
      ).catch(() => false);
      return null;
    }
    const ok = await argon2.verify(row.passwordHash, password).catch(() => false);
    return ok ? { id: row.id, username: row.username } : null;
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!row) return false;
    const ok = await argon2.verify(row.passwordHash, currentPassword).catch(() => false);
    if (!ok) return false;
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    this.db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .run();
    return true;
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
