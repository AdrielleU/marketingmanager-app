import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)');
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
