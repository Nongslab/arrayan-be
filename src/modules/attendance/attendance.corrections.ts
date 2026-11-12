import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { recordAudit, type AuditContext } from '../../lib/audit.js'
import { localDate } from './attendance.engine.js'

const DEFAULT_TIME_ZONE = 'Asia/Jakarta'
/** Toleransi jam server vs klien saat menerima waktu koreksi. */
const FUTURE_TOLERANCE_MS = 5 * 60_000
const MAX_AGE_MS = 366 * 86_400_000

const logSelect = {
  id: true,
  employeeId: true,
  occurredAt: true,
  source: true,
  latitude: true,
  longitude: true,
  ip: true,
  deviceCode: true,
  note: true,
  createdById: true,
  voidedAt: true,
  voidReason: true,
  voidedById: true,
  createdAt: true,
} satisfies Prisma.AttendanceLogSelect

type LogRow = Prisma.AttendanceLogGetPayload<{ select: typeof logSelect }>

export function serializeLog(row: LogRow) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    occurredAt: row.occurredAt.toISOString(),
    source: row.source,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    ip: row.ip,
    deviceCode: row.deviceCode,
    note: row.note,
    voided: row.voidedAt !== null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  }
}

/** US-3.5: HR menambah log absensi manual (lupa clock-out, mesin rusak, dll). */
export async function addCorrection(
  input: { employeeId: string; occurredAt: string; note: string },
  ctx: AuditContext,
) {
  const occurredAt = new Date(input.occurredAt)
  const now = Date.now()
  if (occurredAt.getTime() > now + FUTURE_TOLERANCE_MS) throw new HttpError(422, 'occurredAt tidak boleh di masa depan')
  if (occurredAt.getTime() < now - MAX_AGE_MS) throw new HttpError(422, 'occurredAt maksimal 1 tahun ke belakang')

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: input.employeeId },
      select: { joinDate: true, exitDate: true, officeLocation: { select: { timezone: true } } },
    })
    if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')

    const date = localDate(occurredAt, employee.officeLocation?.timezone ?? DEFAULT_TIME_ZONE)
    if (date < toDateOnly(employee.joinDate)) throw new HttpError(422, 'occurredAt sebelum tanggal masuk kerja')
    if (employee.exitDate && date > toDateOnly(employee.exitDate)) {
      throw new HttpError(422, 'occurredAt setelah tanggal keluar karyawan')
    }

    const log = await tx.attendanceLog.create({
      data: {
        employeeId: input.employeeId,
        occurredAt,
        source: 'MANUAL',
        note: input.note,
        createdById: ctx.actorUserId,
      },
      select: logSelect,
    })
    await recordAudit(tx, ctx, {
      action: 'attendance.correction_add',
      entityType: 'attendance_log',
      entityId: log.id,
      changes: { employeeId: input.employeeId, occurredAt: log.occurredAt, localDate: date, note: input.note },
    })
    return serializeLog(log)
  })
}

/** US-3.5: HR membatalkan log yang salah (tetap tersimpan, tidak dihitung). */
export async function voidLog(id: string, reason: string, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const log = await tx.attendanceLog.findUnique({ where: { id }, select: logSelect })
    if (!log) throw new HttpError(404, 'Log absensi tidak ditemukan')
    if (log.voidedAt) throw new HttpError(409, 'Log sudah dibatalkan')

    const updated = await tx.attendanceLog.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: reason, voidedById: ctx.actorUserId },
      select: logSelect,
    })
    await recordAudit(tx, ctx, {
      action: 'attendance.log_void',
      entityType: 'attendance_log',
      entityId: id,
      changes: { employeeId: log.employeeId, occurredAt: log.occurredAt, source: log.source, reason },
    })
    return serializeLog(updated)
  })
}

/** Log mentah seorang karyawan dalam rentang tanggal (termasuk yang dibatalkan bila diminta). */
export async function listLogs(q: { employeeId: string; from: string; to: string; includeVoided: boolean }) {
  const rows = await prisma.attendanceLog.findMany({
    where: {
      employeeId: q.employeeId,
      ...(q.includeVoided ? {} : { voidedAt: null }),
      // Rentang longgar ±1 hari untuk zona waktu; FE bisa memfilter per tanggal lokal.
      occurredAt: { gte: addDays(fromDateOnly(q.from), -1), lt: addDays(fromDateOnly(q.to), 2) },
    },
    select: logSelect,
    orderBy: { occurredAt: 'asc' },
  })
  return rows.map(serializeLog)
}
