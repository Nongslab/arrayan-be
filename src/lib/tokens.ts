import crypto from 'node:crypto'

/** Hash SHA-256 (hex) — token disimpan di DB hanya dalam bentuk ini. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Token opaque acak 32 byte (64 karakter hex). */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex')
}
