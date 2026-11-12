import bcrypt from 'bcrypt'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { appConfig } from '../../lib/config.js'
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js'
import { getInvitationSender } from '../../lib/notifications/invitation-sender.js'
import {
  consumeAccountToken,
  issueAccountToken,
  PASSWORD_RESET_TOKEN_TTL_HOURS,
} from './account-token.service.js'
import type { ActivateInput, ChangePasswordInput, LoginInput, ResetPasswordInput, UserSessionPayload } from './auth.schema.js'

export { generateOpaqueToken, hashToken }

/** Error yang pesannya aman ditampilkan ke klien (dipetakan ke 400/401 di route). */
export class AuthFlowError extends Error {}

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
      const { user, invalidMessage } = await consumeAccountToken(tx, input.token, 'ACTIVATION')
      if (user.status !== 'PENDING_ACTIVATION' || user.employee?.status === 'INACTIVE') {
        throw new AuthFlowError(invalidMessage)
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIVE' } })
      return { email: user.email }
    })
  },

  /**
   * Lupa password: terbitkan link reset (1 jam) hanya untuk akun ACTIVE dengan karyawan aktif.
   * Selalu "berhasil" dari sisi pemanggil agar tidak membocorkan email mana yang terdaftar.
   * Mengembalikan link hanya di luar production (untuk dev & test).
   */
  async requestPasswordReset(email: string): Promise<{ devResetLink?: string }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { employee: { select: { fullName: true, status: true } } },
    })
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash || user.employee?.status === 'INACTIVE') {
      return {}
    }

    const { token, expiresAt } = await prisma.$transaction((tx) =>
      issueAccountToken(tx, user.id, 'PASSWORD_RESET', PASSWORD_RESET_TOKEN_TTL_HOURS),
    )
    const link = `${appConfig.appBaseUrl}/reset-password?token=${token}`
    await getInvitationSender().send({
      kind: 'PASSWORD_RESET',
      to: user.email,
      fullName: user.employee?.fullName ?? user.email,
      link,
      expiresAt,
    })
    return appConfig.exposeDevLinks ? { devResetLink: link } : {}
  },

  /** Reset password dengan token; seluruh sesi (refresh token) dicabut. */
  async resetPassword(input: ResetPasswordInput): Promise<{ email: string }> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

    return prisma.$transaction(async (tx) => {
      const { user, invalidMessage } = await consumeAccountToken(tx, input.token, 'PASSWORD_RESET')
      if (user.status !== 'ACTIVE' || user.employee?.status === 'INACTIVE') {
        throw new AuthFlowError(invalidMessage)
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } })
      await tx.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } })
      return { email: user.email }
    })
  },

  /**
   * Ganti password oleh user yang sedang login. Semua refresh token lama dicabut;
   * route menerbitkan sesi baru agar perangkat saat ini tetap login.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      throw new AuthFlowError('User tidak ditemukan atau tidak aktif')
    }
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new AuthFlowError('Password saat ini salah')
    }

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS)
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
      prisma.accountToken.deleteMany({ where: { userId, purpose: 'PASSWORD_RESET', usedAt: null } }),
    ])
  },
}
