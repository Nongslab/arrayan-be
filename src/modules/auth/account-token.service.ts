import type { Prisma, TokenPurpose } from '@prisma/client'
import { generateOpaqueToken, hashToken } from './auth.service.js'

export const ACTIVATION_TOKEN_TTL_HOURS = 48

type Tx = Prisma.TransactionClient

/**
 * Terbitkan token sekali pakai untuk user. Token lama dengan tujuan sama yang belum dipakai
 * dihapus, sehingga hanya link terbaru yang berlaku. Mengembalikan token mentah (hanya
 * untuk dikirim ke user — tidak pernah disimpan).
 */
export async function issueAccountToken(
  tx: Tx,
  userId: string,
  purpose: TokenPurpose,
  ttlHours = ACTIVATION_TOKEN_TTL_HOURS,
): Promise<{ token: string; expiresAt: Date }> {
  await tx.accountToken.deleteMany({ where: { userId, purpose, usedAt: null } })

  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  await tx.accountToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt } })
  return { token, expiresAt }
}

/** Hapus seluruh token yang belum dipakai milik user (mis. saat akun dinonaktifkan). */
export async function revokeAccountTokens(tx: Tx, userId: string): Promise<void> {
  await tx.accountToken.deleteMany({ where: { userId, usedAt: null } })
}
