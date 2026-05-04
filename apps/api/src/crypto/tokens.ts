import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "wmd_";
const TOKEN_BYTES = 24;

/**
 * Generates a new client API token.
 *
 * Returns the plaintext (shown to the user once) and its SHA-256 hex hash
 * (stored in the DB for verification).
 */
export function generateClientToken(): { plain: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const plain = TOKEN_PREFIX + raw;
  const hash = hashToken(plain);
  return { plain, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time hex comparison to defend against timing oracles when
 * comparing token hashes.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
