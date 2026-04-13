/**
 * AES-256-GCM envelope encryption for tunnel messages.
 * Uses the RELAY_TOKEN to derive a 256-bit key via SHA-256.
 * Each message gets a random 12-byte IV prepended to the ciphertext.
 *
 * Wire format: base64( IV(12) || ciphertext || authTag(16) )
 * Wrapped as: { _enc: "<base64>" }
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let derivedKey: Buffer | null = null;

function getKey(secret: string): Buffer {
  if (!derivedKey) {
    derivedKey = createHash('sha256').update(secret).digest();
  }
  return derivedKey;
}

export function encrypt(plaintext: string, secret: string): string {
  const key = getKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decrypt(envelope: string, secret: string): string {
  const key = getKey(secret);
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid encrypted message: too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Wrap a JSON message string into an encrypted envelope.
 * Returns the JSON string to send over the wire.
 */
export function encryptMessage(jsonStr: string, secret: string): string {
  return JSON.stringify({ _enc: encrypt(jsonStr, secret) });
}

/**
 * Unwrap an encrypted envelope back to the original JSON string.
 * If the message is not encrypted (no _enc field), returns it as-is.
 */
export function decryptMessage(raw: string, secret: string): string {
  const parsed = JSON.parse(raw);
  if (parsed._enc) {
    return decrypt(parsed._enc, secret);
  }
  // Not encrypted — pass through (allows gradual rollout)
  return raw;
}
