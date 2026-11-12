import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import type { ActivateInput, LoginInput, UserSessionPayload } from './auth.schema.js'

const REFRESH_TOKEN_EXPIRY_DAYS = 7
export const BCRYPT_ROUNDS = 10

/** Relasi yang dibutuhkan untuk membentuk session payload. */
const sessionInclude = {
  role: true,
  employee: { include: { jobTitle: true, department: true } },
} satisfies Prisma.UserInclude

type UserWithSession = Prisma.UserGetPayload<{ include: typeof sessionInclude }>

export function toSessionPayload(user: UserWithSession): UserSessionPayload {
  const { employee } = user
  return {
    id: user.id,
    email: user.email,
    role: {
      code: user.role.code,
      name: user.role.name,
      permissions: (user.role.permissions as string[]) || [],
    },
    employee: employee
      ? {
          id: employee.id,
          nik: employee.nik,
          fullName: employee.fullName,
          jobTitle: {
            id: employee.jobTitle.id,
            code: employee.jobTitle.code,
            name: employee.jobTitle.name,
            level: employee.jobTitle.level,
          },
          department: employee.department
            ? { id: employee.department.id, code: employee.department.code, name: employee.department.name }
            : null,
          managerId: employee.managerId,
        }
      : null,
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export const authService = {
  hashToken,
  generateOpaqueToken,

  async validateUser(input: LoginInput): Promise<UserSessionPayload> {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase().trim() },
      include: sessionInclude,
    })

    // Password dicek lebih dulu agar status akun tidak bocor ke pihak yang tidak tahu password.
    // Akun PENDING_ACTIVATION belum punya password → selalu gagal dengan pesan generik.
    if (!user || !user.passwordHash) {
      throw new Error('Email atau password salah')
    }

    const isValidPassword = await bcrypt.compare(input.password, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Email atau password salah')
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('Akun dinonaktifkan. Hubungi HR Administrator')
    }

    // Update timestamp last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return toSessionPayload(user)
  },

  async createRefreshToken(userId: string): Promise<string> {
    const rawToken = generateOpaqueToken()
    const tokenHash = hashToken(rawToken)

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    })

    return rawToken
  },

  async rotateRefreshToken(rawToken: string): Promise<{ user: UserSessionPayload; newRefreshToken: string }> {
    const tokenHash = hashToken(rawToken)

    const existingToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!existingToken || existingToken.revoked || existingToken.expiresAt < new Date()) {
      throw new Error('Refresh token tidak valid atau telah kedaluwarsa')
    }

    // Revoke token lama (Token Rotation)
    await prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { revoked: true },
    })

    if (existingToken.user.status !== 'ACTIVE') {
      throw new Error('Akun dinonaktifkan')
    }

    // Terbitkan refresh token baru
    const newRefreshToken = await this.createRefreshToken(existingToken.userId)
    const userProfile = await this.getUserProfile(existingToken.userId)

    return {
      user: userProfile,
      newRefreshToken,
    }
  },

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken)
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revoked: false },
      data: { revoked: true },
    })
  },

  async getUserProfile(userId: string): Promise<UserSessionPayload> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: sessionInclude,
    })

    if (!user || user.status !== 'ACTIVE') {
      throw new Error('User tidak ditemukan atau tidak aktif')
    }

    return toSessionPayload(user)
  },

  /**
   * US-2.3: aktivasi akun dengan token undangan. Token harus ACTIVATION, belum dipakai,
   * belum kedaluwarsa, milik akun PENDING_ACTIVATION yang karyawannya masih aktif.
   */
  async activateAccount(input: ActivateInput): Promise<{ email: string }> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

    return prisma.$transaction(async (tx) => {
      const token = await tx.accountToken.findUnique({
        where: { tokenHash: hashToken(input.token) },
        include: { user: { include: { employee: { select: { status: true } } } } },
      })

      const invalid =
        !token ||
        token.purpose !== 'ACTIVATION' ||
        token.usedAt !== null ||
        token.expiresAt < new Date() ||
        token.user.status !== 'PENDING_ACTIVATION' ||
        token.user.employee?.status === 'INACTIVE'
      if (invalid) {
        throw new Error('Link aktivasi tidak valid atau sudah kedaluwarsa. Minta HR mengirim ulang undangan.')
      }

      // Tandai terpakai secara atomik: gagal bila request lain sudah memakainya lebih dulu.
      const consumed = await tx.accountToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      if (consumed.count !== 1) {
        throw new Error('Link aktivasi tidak valid atau sudah kedaluwarsa. Minta HR mengirim ulang undangan.')
      }

      await tx.user.update({ where: { id: token.userId }, data: { passwordHash, status: 'ACTIVE' } })
      await tx.accountToken.deleteMany({ where: { userId: token.userId, purpose: 'ACTIVATION', usedAt: null } })

      return { email: token.user.email }
    })
  },
}
