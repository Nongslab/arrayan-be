import type { LeaveRequestStatus, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { recordAudit, type AuditContext } from '../../lib/audit.js'
import { todayInJakarta } from '../employee/employee.schema.js'
import {
  availableDays,
  collectiveLeaveDays,
  dayCountingFor,
  entitlementFor,
  leaveDaysByYear,
  totalDays,
} from './leave.rules.js'
import type { AdjustmentInput, CreateLeaveInput } from './leave.schema.js'

type Db = Prisma.TransactionClient | typeof prisma

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]
/** Status yang memakai saldo & tidak boleh tumpang tindih. */
const ACTIVE_STATUSES: LeaveRequestStatus[] = ['PENDING', 'APPROVED']

/** Siapa yang mengakses — pemilik pengajuan atau SUPER_ADMIN. */
export interface LeaveViewer {
  isAdmin: boolean
  employeeId: string | null
}

const requestInclude = {
  employee: { select: { id: true, nik: true, fullName: true } },
  leaveType: { select: { id: true, code: true, name: true, category: true, requiresAttachment: true } },
} satisfies Prisma.LeaveRequestInclude

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>

export function serializeLeave(row: RequestRow) {
  const { requiresAttachment, ...leaveType } = row.leaveType
  return {
    id: row.id,
    employee: row.employee,
    leaveType,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    days: row.days,
    reason: row.reason,
    status: row.status,
    attachmentRequired: requiresAttachment,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

function currentYear(): number {
  return Number(todayInJakarta().slice(0, 4))
}

function yearRange(year: number) {
  return { gte: fromDateOnly(`${year}-01-01`), lte: fromDateOnly(`${year}-12-31`) }
}

async function employeeContext(db: Db, employeeId: string) {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, status: true, joinDate: true, workShift: { select: { workDays: true } } },
  })
  if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')
  return {
    id: employee.id,
    status: employee.status,
    joinDate: toDateOnly(employee.joinDate),
    workDays: employee.workShift?.workDays.length ? employee.workShift.workDays : DEFAULT_WORK_DAYS,
  }
}

/** Tanggal hari libur aktif (semua jenis) pada tahun-tahun terkait. */
async function holidayDates(db: Db, years: number[], kind?: 'COLLECTIVE_LEAVE') {
  const rows = await db.holiday.findMany({
    where: {
      isActive: true,
      ...(kind ? { kind } : {}),
      date: { gte: fromDateOnly(`${Math.min(...years)}-01-01`), lte: fromDateOnly(`${Math.max(...years)}-12-31`) },
    },
    select: { date: true },
  })
  return rows.map((row) => toDateOnly(row.date))
}

/** Jenis cuti yang saldonya dipakai oleh `leaveType` (null = tanpa kuota). */
async function balanceTypeFor(db: Db, leaveType: { id: string; defaultQuota: number; deductsAnnualLeave: boolean }) {
  if (leaveType.deductsAnnualLeave) {
    const annual = await db.leaveType.findFirst({
      where: { category: 'ANNUAL', isActive: true, defaultQuota: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    })
    return annual
  }
  if (leaveType.defaultQuota > 0) return db.leaveType.findUnique({ where: { id: leaveType.id } })
  return null
}

function daysInYear(daysByYear: Prisma.JsonValue, year: number): number {
  const value = (daysByYear as Record<string, number> | null)?.[String(year)]
  return typeof value === 'number' ? value : 0
}

/** Saldo semua jenis cuti berkuota untuk satu karyawan & tahun. */
async function computeBalances(db: Db, employeeId: string, year: number) {
  const employee = await employeeContext(db, employeeId)
  const [quotaTypes, allTypes, requests, adjustments, collectiveDates] = await Promise.all([
    db.leaveType.findMany({ where: { isActive: true, defaultQuota: { gt: 0 } }, orderBy: { name: 'asc' } }),
    db.leaveType.findMany({ select: { id: true, defaultQuota: true, deductsAnnualLeave: true } }),
    db.leaveRequest.findMany({
      where: {
        employeeId,
        status: { in: ACTIVE_STATUSES },
        startDate: { lte: fromDateOnly(`${year}-12-31`) },
        endDate: { gte: fromDateOnly(`${year}-01-01`) },
      },
      select: { leaveTypeId: true, status: true, daysByYear: true },
    }),
    db.leaveBalanceAdjustment.groupBy({
      by: ['leaveTypeId'],
      where: { employeeId, year },
      _sum: { days: true },
    }),
    holidayDates(db, [year], 'COLLECTIVE_LEAVE'),
  ])

  const annualTypeId = quotaTypes.find((t) => t.category === 'ANNUAL')?.id
  const typeById = new Map(allTypes.map((t) => [t.id, t]))
  const consumedTypeId = (leaveTypeId: string) => {
    const t = typeById.get(leaveTypeId)
    if (!t) return null
    if (t.deductsAnnualLeave) return annualTypeId ?? null
    return t.defaultQuota > 0 ? t.id : null
  }

  return quotaTypes.map((type) => {
    let used = 0
    let pending = 0
    for (const request of requests) {
      if (consumedTypeId(request.leaveTypeId) !== type.id) continue
      const days = daysInYear(request.daysByYear, year)
      if (request.status === 'APPROVED') used += days
      else pending += days
    }
    const figures = {
      entitlement: entitlementFor({ defaultQuota: type.defaultQuota, year, joinDate: employee.joinDate }),
      adjustments: adjustments.find((a) => a.leaveTypeId === type.id)?._sum.days ?? 0,
      collectiveLeave:
        type.category === 'ANNUAL'
          ? collectiveLeaveDays({ dates: collectiveDates, year, workDays: employee.workDays, joinDate: employee.joinDate })
          : 0,
      used,
      pending,
    }
    return {
      leaveType: { id: type.id, code: type.code, name: type.name, category: type.category },
      year,
      ...figures,
      available: availableDays(figures),
    }
  })
}

export const leaveService = {
  async balances(employeeId: string, year = currentYear()) {
    return computeBalances(prisma, employeeId, year)
  },

  /** US-5.2: karyawan mengajukan cuti/izin/sakit untuk dirinya sendiri. */
  async create(employeeId: string, input: CreateLeaveInput, ctx: AuditContext) {
    const id = await prisma.$transaction(async (tx) => {
      // Serialkan pengajuan per karyawan agar dua request bersamaan tidak melampaui saldo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${employeeId}))`

      const employee = await employeeContext(tx, employeeId)
      if (employee.status !== 'ACTIVE') throw new HttpError(422, 'Karyawan tidak aktif')
      if (input.startDate < employee.joinDate) {
        throw new HttpError(422, `startDate tidak boleh sebelum tanggal masuk kerja (${employee.joinDate})`)
      }

      const leaveType = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } })
      if (!leaveType) throw new HttpError(422, 'leaveTypeId: jenis cuti tidak ditemukan')
      if (!leaveType.isActive) throw new HttpError(422, 'leaveTypeId: jenis cuti tidak aktif')

      const years = [Number(input.startDate.slice(0, 4)), Number(input.endDate.slice(0, 4))]
      const perYear = leaveDaysByYear({
        start: input.startDate,
        end: input.endDate,
        counting: dayCountingFor(leaveType.category),
        workDays: employee.workDays,
        holidays: new Set(await holidayDates(tx, years)),
      })
      const days = totalDays(perYear)
      if (days === 0) throw new HttpError(422, 'Rentang tanggal tidak mengandung hari kerja')

      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: { in: ACTIVE_STATUSES },
          startDate: { lte: fromDateOnly(input.endDate) },
          endDate: { gte: fromDateOnly(input.startDate) },
        },
        select: { startDate: true, endDate: true },
      })
      if (overlap) {
        throw new HttpError(
          409,
          `Tumpang tindih dengan pengajuan lain (${toDateOnly(overlap.startDate)} s.d. ${toDateOnly(overlap.endDate)})`,
        )
      }

      const balanceType = await balanceTypeFor(tx, leaveType)
      if (balanceType) {
        for (const [year, requested] of perYear) {
          const balance = (await computeBalances(tx, employeeId, year)).find((b) => b.leaveType.id === balanceType.id)
          const available = balance?.available ?? 0
          if (requested > available) {
            throw new HttpError(
              422,
              `Saldo ${balanceType.name} ${year} tidak cukup: tersedia ${available} hari, diajukan ${requested} hari`,
            )
          }
        }
      }

      const created = await tx.leaveRequest.create({
        data: {
          employeeId,
          leaveTypeId: leaveType.id,
          startDate: fromDateOnly(input.startDate),
          endDate: fromDateOnly(input.endDate),
          days,
          daysByYear: Object.fromEntries([...perYear].map(([y, d]) => [String(y), d])),
          reason: input.reason ?? null,
        },
      })
      await recordAudit(tx, ctx, {
        action: 'leave.create',
        entityType: 'leave_request',
        entityId: created.id,
        changes: { leaveType: leaveType.code, startDate: input.startDate, endDate: input.endDate, days },
      })
      return created.id
    })

    return serializeLeave(await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }))
  },

  async getById(id: string, viewer: LeaveViewer) {
    const row = await prisma.leaveRequest.findUnique({ where: { id }, include: requestInclude })
    // Bukan pemilik & bukan admin → 404 (tidak membocorkan keberadaan pengajuan orang lain).
    if (!row || (!viewer.isAdmin && row.employeeId !== viewer.employeeId)) {
      throw new HttpError(404, 'Pengajuan tidak ditemukan')
    }
    return serializeLeave(row)
  },

  async list(filter: {
    employeeId?: string
    leaveTypeId?: string
    status?: LeaveRequestStatus
    from?: string
    to?: string
    page: number
    limit: number
  }) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.leaveTypeId ? { leaveTypeId: filter.leaveTypeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.to ? { startDate: { lte: fromDateOnly(filter.to) } } : {}),
      ...(filter.from ? { endDate: { gte: fromDateOnly(filter.from) } } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      prisma.leaveRequest.count({ where }),
    ])
    return { data: rows.map(serializeLeave), meta: { page: filter.page, limit: filter.limit, total } }
  },

  listForYear(employeeId: string, q: { year?: number; status?: LeaveRequestStatus; page: number; limit: number }) {
    const range = q.year ? yearRange(q.year) : undefined
    return this.list({
      employeeId,
      status: q.status,
      ...(range ? { from: toDateOnly(range.gte), to: toDateOnly(range.lte) } : {}),
      page: q.page,
      limit: q.limit,
    })
  },

  /**
   * US-5.4: pembatalan. Pemilik hanya selama PENDING; SUPER_ADMIN juga untuk APPROVED
   * (wajib alasan) — saldo otomatis kembali karena status CANCELLED tidak dihitung.
   */
  async cancel(id: string, reason: string | undefined, viewer: LeaveViewer, ctx: AuditContext) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.leaveRequest.findUnique({ where: { id } })
      if (!row || (!viewer.isAdmin && row.employeeId !== viewer.employeeId)) {
        throw new HttpError(404, 'Pengajuan tidak ditemukan')
      }
      if (row.status === 'CANCELLED' || row.status === 'REJECTED') {
        throw new HttpError(409, `Pengajuan sudah berstatus ${row.status}`)
      }
      if (row.status === 'APPROVED') {
        if (!viewer.isAdmin) throw new HttpError(403, 'Pengajuan yang sudah disetujui hanya dapat dibatalkan oleh HR')
        if (!reason) throw new HttpError(400, 'reason wajib diisi untuk membatalkan pengajuan yang sudah disetujui')
      }

      const updated = await tx.leaveRequest.updateMany({
        where: { id, status: row.status },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
      })
      if (updated.count !== 1) throw new HttpError(409, 'Status pengajuan berubah, silakan muat ulang')

      await recordAudit(tx, ctx, {
        action: 'leave.cancel',
        entityType: 'leave_request',
        entityId: id,
        changes: { status: { from: row.status, to: 'CANCELLED' }, reason: reason ?? null },
      })
    })
    return this.getById(id, { isAdmin: true, employeeId: null })
  },

  /** US-5.1: penyesuaian saldo oleh HR (+/- hari). */
  async adjust(input: AdjustmentInput, ctx: AuditContext) {
    return prisma.$transaction(async (tx) => {
      await employeeContext(tx, input.employeeId)
      const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } })
      if (!type) throw new HttpError(422, 'leaveTypeId: jenis cuti tidak ditemukan')
      if (type.defaultQuota <= 0) throw new HttpError(422, 'leaveTypeId: jenis cuti ini tidak berkuota')

      const adjustment = await tx.leaveBalanceAdjustment.create({ data: input })
      await recordAudit(tx, ctx, {
        action: 'leave.balance_adjust',
        entityType: 'employee',
        entityId: input.employeeId,
        changes: { leaveType: type.code, year: input.year, days: input.days, reason: input.reason },
      })
      const balances = await computeBalances(tx, input.employeeId, input.year)
      return { adjustmentId: adjustment.id, balance: balances.find((b) => b.leaveType.id === type.id)! }
    })
  },
}
