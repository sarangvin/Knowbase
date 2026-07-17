// AES-256-GCM for BYO API keys at rest. API_KEY_ENCRYPTION_KEY is a 32-byte
// key, base64-encoded in the environment. Ciphertext/nonce/authTag are stored
// as base64 text (see schema.ts) — GCM's auth tag is appended to the
// ciphertext so a single column round-trips both.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function loadKey(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_KEY
  if (!raw) throw new Error('API_KEY_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('API_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes')
  return key
}

export interface Encrypted {
  ciphertext: string // base64, includes the GCM auth tag appended
  nonce: string // base64
}

export function encryptSecret(plaintext: string): Encrypted {
  const key = loadKey()
  const nonce = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, nonce)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([enc, authTag]).toString('base64'),
    nonce: nonce.toString('base64'),
  }
}

export function decryptSecret(encrypted: Encrypted): string {
  const key = loadKey()
  const nonce = Buffer.from(encrypted.nonce, 'base64')
  const combined = Buffer.from(encrypted.ciphertext, 'base64')
  const authTag = combined.subarray(combined.length - 16)
  const enc = combined.subarray(0, combined.length - 16)
  const decipher = createDecipheriv(ALGO, key, nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
