import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for provider config blobs at rest.
 *
 * Output format (base64 url-safe-ish, single string):
 *   v1.<iv_b64>.<tag_b64>.<ciphertext_b64>
 *
 * - 12-byte random IV per encryption (NIST recommended for GCM).
 * - 16-byte auth tag.
 * - Key length must be 32 bytes (loaded from APP_ENCRYPTION_KEY env, hex).
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;

export function encryptJSON(value: unknown, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptJSON<T = unknown>(blob: string, key: Buffer): T {
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes");
  }
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid ciphertext format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64!, "base64");
  const tag = Buffer.from(tagB64!, "base64");
  const ct = Buffer.from(ctB64!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
