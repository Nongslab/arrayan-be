import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import type { LoginInput, UserSessionPayload } from './auth.schema.js'

const REFRESH_TOKEN_EXPIRY_DAYS = 7

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

    if (!user) {
      throw new Error('Email atau password salah')
    }

    if (!user.isActive) {
      throw new Error('Akun dinonaktifkan. Hubungi HR Administrator')
    }

    const isValidPassword = await bcrypt.compare(input.password, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Email atau password salah')
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

    if (!existingToken.user.isActive) {
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

    if (!user || !user.isActive) {
      throw new Error('User tidak ditemukan atau tidak aktif')
    }

    return toSessionPayload(user)
  },
}
