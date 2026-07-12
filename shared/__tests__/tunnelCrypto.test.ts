import { describe, it, expect, beforeEach } from 'vitest';

// Reset the module-level key cache between tests by re-importing
let encrypt: typeof import('../src/crypto/tunnelCrypto').encrypt;
let decrypt: typeof import('../src/crypto/tunnelCrypto').decrypt;
let encryptMessage: typeof import('../src/crypto/tunnelCrypto').encryptMessage;
let decryptMessage: typeof import('../src/crypto/tunnelCrypto').decryptMessage;

beforeEach(async () => {
  // Force fresh module to reset cached derivedKey
  const mod = await import('../src/crypto/tunnelCrypto');
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
  encryptMessage = mod.encryptMessage;
  decryptMessage = mod.decryptMessage;
});

describe('tunnelCrypto', () => {
  const secret = 'test-secret-key-12345';

  describe('encrypt / decrypt', () => {
    it('round-trips a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encrypt(plaintext, secret);
      expect(encrypted).not.toBe(plaintext);
      expect(decrypt(encrypted, secret)).toBe(plaintext);
    });

    it('rejects empty string encryption (minimum 1 byte ciphertext required)', () => {
      const encrypted = encrypt('', secret);
      expect(() => decrypt(encrypted, secret)).toThrow('too short');
    });

    it('round-trips unicode content', () => {
      const text = '你好世界 🌍 éàü';
      const encrypted = encrypt(text, secret);
      expect(decrypt(encrypted, secret)).toBe(text);
    });

    it('round-trips large payloads', () => {
      const text = 'x'.repeat(100_000);
      const encrypted = encrypt(text, secret);
      expect(decrypt(encrypted, secret)).toBe(text);
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
      const a = encrypt('same input', secret);
      const b = encrypt('same input', secret);
      expect(a).not.toBe(b);
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = encrypt('test', secret);
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 1] ^= 0xff; // flip last byte (auth tag)
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered, secret)).toThrow();
    });

    it('throws on too-short envelope', () => {
      const short = Buffer.alloc(20).toString('base64');
      expect(() => decrypt(short, secret)).toThrow('too short');
    });
  });

  describe('encryptMessage / decryptMessage', () => {
    it('round-trips a JSON string through message envelope', () => {
      const json = JSON.stringify({ type: 'auth', token: 'abc' });
      const encrypted = encryptMessage(json, secret);

      const parsed = JSON.parse(encrypted);
      expect(parsed).toHaveProperty('_enc');

      const decrypted = decryptMessage(encrypted, secret);
      expect(decrypted).toBe(json);
    });

    it('passes through unencrypted JSON messages', () => {
      const raw = JSON.stringify({ type: 'ping' });
      const result = decryptMessage(raw, secret);
      expect(result).toBe(raw);
    });

    it('throws on malformed JSON input to decryptMessage', () => {
      expect(() => decryptMessage('not json', secret)).toThrow();
    });
  });
});
