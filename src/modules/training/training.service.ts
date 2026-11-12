import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { addDays, fromDateOnly } from '../../lib/dates.js'
import { diffForAudit, recordAudit, type AuditContext } from '../../lib/audit.js'
import type { CreateTrainingInput, UpdateTrainingInput } from './training.schema.js'

type Tx = Prisma.TransactionClient

/** Siapa yang melihat — menentukan visibilitas remarks peserta. */
export interface TrainingViewer {
  isAdmin: boolean
  employeeId: string | null
}

const trainingInclude = {
  category: { select: { id: true, code: true, name: true } },
  participants: {
    include: {
      employee: { select: { id: true, nik: true, fullName: true, jobTitle: { select: { id: true, code: true, name: true } } } },
    },
    orderBy: { employee: { fullName: 'asc' } },
  },
} satisfies Prisma.TrainingInclude

type TrainingRow = Prisma.TrainingGetPayload<{ include: typeof trainingInclude }>

function serializeTraining(row: TrainingRow, viewer: TrainingViewer, withParticipants: boolean) {
  const mine = row.participants.find((p) => p.employeeId === viewer.employeeId)
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    organizer: row.organizer,
    location: row.location,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
    participantCount: row.participants.length,
    isParticipant: Boolean(mine),
    ...(withParticipants
      ? {
          participants: row.participants.map((p) => {
            // Remarks & rating hanya untuk HR dan peserta itu sendiri.
            const canSeeFeedback = viewer.isAdmin || p.employeeId === viewer.employeeId
            return {
              employee: p.employee,
              attended: p.attended,
              remarks: canSeeFeedback ? p.remarks : null,
              rating: canSeeFeedback ? p.rating : null,
              remarkedAt: canSeeFeedback ? (p.remarkedAt?.toISOString() ?? null) : null,
            }
          }),
        }
      : {}),
  }
}

async function assertCategory(tx: Tx, categoryId: string) {
  const category = await tx.trainingCategory.findUnique({ where: { id: categoryId }, select: { isActive: true } })
  if (!category) throw new HttpError(422, 'categoryId: kategori training tidak ditemukan')
  if (!category.isActive) throw new HttpError(422, 'categoryId: kategori training tidak aktif')
}

async function assertActiveEmployees(tx: Tx, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  const found = await tx.employee.findMany({ where: { id: { in: unique }, status: 'ACTIVE' }, select: { id: true } })
  if (found.length !== unique.length) {
    const ok = new Set(found.map((e) => e.id))
    throw new HttpError(422, `Peserta tidak ditemukan atau tidak aktif: ${unique.filter((id) => !ok.has(id)).join(', ')}`)
  }
  return unique
}

async function findOrThrow(tx: Tx | typeof prisma, id: string) {
  const row = await tx.training.findUnique({ where: { id }, include: trainingInclude })
  if (!row) throw new HttpError(404, 'Training tidak ditemukan')
  return row
}

export const trainingService = {
  async create(input: CreateTrainingInput, ctx: AuditContext) {
    const { participantIds, ...fields } = input
    const id = await prisma.$transaction(async (tx) => {
      await assertCategory(tx, fields.categoryId)
      const participants = participantIds ? await assertActiveEmployees(tx, participantIds) : []
      const training = await tx.training.create({
        data: {
          ...fields,
          startAt: new Date(fields.startAt),
          endAt: new Date(fields.endAt),
          participants: { create: participants.map((employeeId) => ({ employeeId })) },
        },
      })
      await recordAudit(tx, ctx, {
        action: 'training.create',
        entityType: 'training',
        entityId: training.id,
        changes: { after: training, participantIds: participants },
      })
      return training.id
    })
    return serializeTraining(await findOrThrow(prisma, id), { isAdmin: true, employeeId: null }, true)
  },

  async update(id: string, input: UpdateTrainingInput, ctx: AuditContext) {
    await prisma.$transaction(async (tx) => {
      const { participants: _p, category: _c, ...before } = await findOrThrow(tx, id)
      if (input.categoryId) await assertCategory(tx, input.categoryId)
      const startAt = input.startAt ? new Date(input.startAt) : before.startAt
      const endAt = input.endAt ? new Date(input.endAt) : before.endAt
      if (endAt <= startAt) throw new HttpError(400, 'endAt harus setelah startAt')

      const after = await tx.training.update({
        where: { id },
        data: {
          ...input,
          ...(input.startAt ? { startAt } : {}),
          ...(input.endAt ? { endAt } : {}),
        },
      })
      await recordAudit(tx, ctx, {
        action: input.status === 'CANCELLED' && before.status !== 'CANCELLED' ? 'training.cancel' : 'training.update',
        entityType: 'training',
        entityId: id,
        changes: diffForAudit(before, after),
      })
    })
    return serializeTraining(await findOrThrow(prisma, id), { isAdmin: true, employeeId: null }, true)
  },

  /** Ganti daftar peserta. Peserta yang sudah mengisi remarks tidak boleh dikeluarkan. */
  async setParticipants(id: string, employeeIds: string[], ctx: AuditContext) {
    await prisma.$transaction(async (tx) => {
      const training = await findOrThrow(tx, id)
      const next = await assertActiveEmployees(tx, employeeIds)
      const current = training.participants.map((p) => p.employeeId)
      const removed = training.participants.filter((p) => !next.includes(p.employeeId))
      const withFeedback = removed.filter((p) => p.remarks !== null)
      if (withFeedback.length > 0) {
        throw new HttpError(
          409,
          `Peserta yang sudah mengisi remarks tidak dapat dikeluarkan: ${withFeedback.map((p) => p.employee.fullName).join(', ')}`,
        )
      }
      const added = next.filter((employeeId) => !current.includes(employeeId))

      await tx.trainingParticipant.deleteMany({ where: { trainingId: id, employeeId: { in: removed.map((p) => p.employeeId) } } })
      await tx.trainingParticipant.createMany({ data: added.map((employeeId) => ({ trainingId: id, employeeId })) })
      await recordAudit(tx, ctx, {
        action: 'training.participants_update',
        entityType: 'training',
        entityId: id,
        changes: { added, removed: removed.map((p) => p.employeeId) },
      })
    })
    return serializeTraining(await findOrThrow(prisma, id), { isAdmin: true, employeeId: null }, true)
  },

  async markAttendance(id: string, employeeId: string, attended: boolean, ctx: AuditContext) {
    await prisma.$transaction(async (tx) => {
      const participant = await tx.trainingParticipant.findUnique({ where: { trainingId_employeeId: { trainingId: id, employeeId } } })
      if (!participant) throw new HttpError(404, 'Peserta tidak terdaftar pada training ini')
      await tx.trainingParticipant.update({ where: { id: participant.id }, data: { attended } })
      await recordAudit(tx, ctx, {
        action: 'training.attendance_mark',
        entityType: 'training',
        entityId: id,
        changes: { employeeId, attended: { from: participant.attended, to: attended } },
      })
    })
    return serializeTraining(await findOrThrow(prisma, id), { isAdmin: true, employeeId: null }, true)
  },

  /** Peserta mengisi remarks setelah training selesai (boleh diperbarui). */
  async submitRemarks(id: string, employeeId: string, input: { remarks: string; rating?: number }) {
    const training = await prisma.training.findUnique({ where: { id }, select: { endAt: true, status: true } })
    const participant = await prisma.trainingParticipant.findUnique({
      where: { trainingId_employeeId: { trainingId: id, employeeId } },
    })
    if (!training || !participant) throw new HttpError(404, 'Anda tidak terdaftar sebagai peserta training ini')
    if (training.status === 'CANCELLED') throw new HttpError(409, 'Training dibatalkan')
    if (training.endAt > new Date()) throw new HttpError(409, 'Remarks baru bisa diisi setelah training selesai')

    await prisma.trainingParticipant.update({
      where: { id: participant.id },
      data: { remarks: input.remarks, rating: input.rating ?? null, remarkedAt: new Date() },
    })
    return serializeTraining(await findOrThrow(prisma, id), { isAdmin: false, employeeId }, true)
  },

  async getById(id: string, viewer: TrainingViewer) {
    return serializeTraining(await findOrThrow(prisma, id), viewer, true)
  },

  /** Agenda training — semua karyawan login (sumber widget "Jadwal Training" & kalender). */
  async list(
    q: { from?: string; to?: string; categoryId?: string; mine: boolean; includeCancelled: boolean; page: number; limit: number },
    viewer: TrainingViewer,
  ) {
    if (q.mine && !viewer.employeeId) return { data: [], meta: { page: q.page, limit: q.limit, total: 0 } }
    const where: Prisma.TrainingWhereInput = {
      ...(q.includeCancelled ? {} : { status: 'SCHEDULED' }),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.from ? { endAt: { gte: fromDateOnly(q.from) } } : {}),
      ...(q.to ? { startAt: { lt: addDays(fromDateOnly(q.to), 1) } } : {}),
      ...(q.mine ? { participants: { some: { employeeId: viewer.employeeId! } } } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.training.findMany({
        where,
        include: trainingInclude,
        orderBy: [{ startAt: 'asc' }, { title: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.training.count({ where }),
    ])
    return { data: rows.map((row) => serializeTraining(row, viewer, false)), meta: { page: q.page, limit: q.limit, total } }
  },

  /** Laporan training (HR/Management): baris per peserta + ringkasan per kategori. */
  async report(q: { from: string; to: string; categoryId?: string; employeeId?: string }) {
    const rows = await prisma.trainingParticipant.findMany({
      where: {
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        training: {
          status: 'SCHEDULED',
          startAt: { gte: fromDateOnly(q.from), lt: addDays(fromDateOnly(q.to), 1) },
          ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        },
      },
      include: {
        employee: { select: { id: true, nik: true, fullName: true, department: { select: { id: true, code: true, name: true } } } },
        training: { select: { id: true, title: true, startAt: true, endAt: true, organizer: true, category: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: [{ training: { startAt: 'asc' } }, { employee: { fullName: 'asc' } }],
    })

    const byCategory = new Map<string, { category: { id: string; code: string; name: string }; trainings: Set<string>; participants: number; attended: number; ratings: number[] }>()
    for (const row of rows) {
      const key = row.training.category.id
      const entry = byCategory.get(key) ?? { category: row.training.category, trainings: new Set(), participants: 0, attended: 0, ratings: [] }
      entry.trainings.add(row.training.id)
      entry.participants += 1
      if (row.attended) entry.attended += 1
      if (row.rating !== null) entry.ratings.push(row.rating)
      byCategory.set(key, entry)
    }

    return {
      data: rows.map((row) => ({
        training: {
          id: row.training.id,
          title: row.training.title,
          category: row.training.category,
          organizer: row.training.organizer,
          startAt: row.training.startAt.toISOString(),
          endAt: row.training.endAt.toISOString(),
        },
        employee: row.employee,
        attended: row.attended,
        rating: row.rating,
        remarks: row.remarks,
      })),
      summary: [...byCategory.values()].map((entry) => ({
        category: entry.category,
        trainings: entry.trainings.size,
        participants: entry.participants,
        attended: entry.attended,
        averageRating: entry.ratings.length
          ? Math.round((entry.ratings.reduce((a, b) => a + b, 0) / entry.ratings.length) * 100) / 100
          : null,
      })),
      meta: { from: q.from, to: q.to, total: rows.length },
    }
  },
}
