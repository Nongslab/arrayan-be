import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'

/** Kredensial Super Admin dari prisma/seed.ts. */
export const SUPER_ADMIN = { email: 'superadmin@arrayan.com', password: 'Password123!' } as const

/** Instance app siap `inject()` tanpa listen port & tanpa log. */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false })
  await app.ready()
  return app
}

/** Login dan kembalikan access token untuk header `Authorization: Bearer`. */
export async function loginAs(
  app: FastifyInstance,
  credentials: { email: string; password: string } = SUPER_ADMIN,
): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: credentials })
  if (res.statusCode !== 200) {
    throw new Error(`Login gagal (${res.statusCode}): ${res.body}`)
  }
  return res.json().accessToken as string
}

export function bearer(token: string) {
  return { authorization: `Bearer ${token}` }
}

/**
 * Buat user (tanpa employee) dengan role tertentu untuk menguji RBAC.
 * Email unik per panggilan; password sama untuk semua user test.
 */
export async function createUserWithRole(roleCode: string) {
  const { prisma } = await import('../lib/prisma.js')
  const bcrypt = (await import('bcrypt')).default
  const password = 'TestPassword1!'
  const email = `itest.${roleCode.toLowerCase()}.${uniqueSuffix().toLowerCase()}@arrayan.test`
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } })
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 4), roleId: role.id } })
  return { email, password }
}

let counter = 0
/** Sufiks UPPER alfanumerik unik per proses — aman dipakai di `code` master data. */
export function uniqueSuffix(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter}`.toUpperCase()
}
