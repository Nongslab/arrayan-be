import type { FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'

/** Klien Prisma biasa atau klien transaksi — audit ditulis di transaksi yang sama dengan aksinya. */
export type AuditDb = PrismaClient | Prisma.TransactionClient

/** Siapa yang melakukan aksi & dari mana. */
export interface AuditContext {
  actorUserId: string | null
  actorEmail: string | null
  ip: string | null
  userAgent: string | null
}

export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | null
  changes?: Record<string, unknown> | null
}

/** Field yang tidak boleh pernah masuk audit log. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
])

/** Field teknis yang tidak berguna di diff. */
const IGNORED_DIFF_KEYS = new Set(['createdAt', 'updatedAt'])

export function auditContextFrom(request: FastifyRequest): AuditContext {
  const userAgent = request.headers['user-agent']
  return {
    actorUserId: request.userSession?.id ?? null,
    actorEmail: request.userSession?.email ?? null,
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
  }
}

/** Konteks untuk aksi yang pelakunya diketahui dari hasil aksi (mis. aktivasi akun publik). */
export function withActor(ctx: AuditContext, actor: { id: string; email: string }): AuditContext {
  return { ...ctx, actorUserId: actor.id, actorEmail: actor.email }
}

/** Ubah nilai menjadi JSON aman: buang field sensitif, Decimal → number, Date → ISO. */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return (value as { toNumber(): number }).toNumber()
  }
  if (Array.isArray(value)) return value.map(sanitizeForAudit)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEYS.has(key))
        .map(([key, inner]) => [key, sanitizeForAudit(inner)]),
    )
  }
  return value
}

/** Diff dangkal: `{ field: { from, to } }` hanya untuk field yang berubah. */
export function diffForAudit(before: object, after: object): Record<string, { from: unknown; to: unknown }> {
  const b = sanitizeForAudit(before) as Record<string, unknown>
  const a = sanitizeForAudit(after) as Record<string, unknown>
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (IGNORED_DIFF_KEYS.has(key)) continue
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      changes[key] = { from: b[key] ?? null, to: a[key] ?? null }
    }
  }
  return changes
}

export async function recordAudit(db: AuditDb, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: ctx.actorUserId,
      actorEmail: ctx.actorEmail,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      changes: entry.changes ? (sanitizeForAudit(entry.changes) as Prisma.InputJsonValue) : undefined,
    },
  })
}
