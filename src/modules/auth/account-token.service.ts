import type { Prisma, TokenPurpose } from '@prisma/client'
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js'

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

export const PASSWORD_RESET_TOKEN_TTL_HOURS = 1

const INVALID_LINK: Record<TokenPurpose, string> = {
  ACTIVATION: 'Link aktivasi tidak valid atau sudah kedaluwarsa. Minta HR mengirim ulang undangan.',
  PASSWORD_RESET: 'Link reset password tidak valid atau sudah kedaluwarsa. Silakan ajukan ulang lupa password.',
}

export class InvalidAccountTokenError extends Error {}

/**
 * Pakai token sekali pakai: cocokkan hash & tujuan, belum dipakai, belum kedaluwarsa,
 * lalu tandai terpakai secara atomik (request kedua dengan token sama akan gagal).
 * Mengembalikan user pemilik token beserta status karyawannya.
 */
export async function consumeAccountToken(tx: Tx, rawToken: string, purpose: TokenPurpose) {
  const token = await tx.accountToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: { employee: { select: { status: true } } } } },
  })

  if (!token || token.purpose !== purpose || token.usedAt !== null || token.expiresAt < new Date()) {
    throw new InvalidAccountTokenError(INVALID_LINK[purpose])
  }

  const consumed = await tx.accountToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (consumed.count !== 1) throw new InvalidAccountTokenError(INVALID_LINK[purpose])

  // Link lain dengan tujuan sama tidak berlaku lagi.
  await tx.accountToken.deleteMany({ where: { userId: token.userId, purpose, usedAt: null } })
  return { user: token.user, invalidMessage: INVALID_LINK[purpose] }
}
