import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { diffForAudit, recordAudit, type AuditContext } from '../../lib/audit.js'
import { employeeService } from '../employee/employee.service.js'
import { localDate } from '../attendance/attendance.engine.js'

const TIME_ZONE = 'Asia/Jakarta'

export type CalendarItemType = 'HOLIDAY' | 'BIRTHDAY' | 'EVENT' | 'TRAINING' | 'LEAVE'

export interface CalendarItem {
  type: CalendarItemType
  id: string
  title: string
  /** Tanggal mulai & selesai (yyyy-MM-dd, inklusif, waktu lokal kantor) */
  startDate: string
  endDate: string
  allDay: boolean
  /** HH:mm lokal bila tidak sepanjang hari */
  startTime: string | null
  endTime: string | null
  location: string | null
  /** Karyawan terkait (ulang tahun / cuti / peserta pada tampilan master) */
  employee: { id: string; fullName: string } | null
  /** Info tambahan per jenis: kind libur, jenis & status cuti, kategori training */
  detail: Record<string, string> | null
}

const TYPE_ORDER: Record<CalendarItemType, number> = { HOLIDAY: 0, EVENT: 1, TRAINING: 2, LEAVE: 3, BIRTHDAY: 4 }

function localTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant)
}

const overlaps = (from: string, to: string) => ({
  startDate: { lte: fromDateOnly(to) },
  endDate: { gte: fromDateOnly(from) },
})

/**
 * Kalender gabungan (US-6.4). Personal: libur, ulang tahun, event kantor, training yang saya ikuti,
 * cuti/izin saya. Master (SUPER_ADMIN): seluruh training & seluruh cuti karyawan.
 */
export async function calendarFeed(q: { from: string; to: string; master: boolean; employeeId: string | null }) {
  const fromInstant = fromDateOnly(q.from)
  const toExclusive = new Date(fromDateOnly(q.to).getTime() + 86_400_000)
  const leaveOwner: Prisma.LeaveRequestWhereInput = q.master ? { employee: { status: 'ACTIVE' } } : { employeeId: q.employeeId ?? '__none__' }
  const trainingScope: Prisma.TrainingWhereInput = q.master ? {} : { participants: { some: { employeeId: q.employeeId ?? '__none__' } } }

  const [holidays, birthdays, events, trainings, leaves] = await Promise.all([
    prisma.holiday.findMany({
      where: { isActive: true, date: { gte: fromInstant, lte: fromDateOnly(q.to) } },
      select: { id: true, name: true, date: true, kind: true },
    }),
    employeeService.birthdays({ from: q.from, to: q.to }),
    prisma.calendarEvent.findMany({ where: { isActive: true, ...overlaps(q.from, q.to) } }),
    prisma.training.findMany({
      where: { status: 'SCHEDULED', startAt: { lt: toExclusive }, endAt: { gte: fromInstant }, ...trainingScope },
      select: { id: true, title: true, location: true, startAt: true, endAt: true, category: { select: { name: true } } },
    }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, ...overlaps(q.from, q.to), ...leaveOwner },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        leaveType: { select: { name: true, category: true } },
        employee: { select: { id: true, fullName: true } },
      },
    }),
  ])

  const items: CalendarItem[] = [
    ...holidays.map((h) => ({
      type: 'HOLIDAY' as const,
      id: h.id,
      title: h.name,
      startDate: toDateOnly(h.date),
      endDate: toDateOnly(h.date),
      allDay: true,
      startTime: null,
      endTime: null,
      location: null,
      employee: null,
      detail: { kind: h.kind },
    })),
    ...birthdays.data.map((b) => ({
      type: 'BIRTHDAY' as const,
      id: `${b.id}:${b.date}`,
      title: `Ulang tahun ${b.fullName}`,
      startDate: b.date,
      endDate: b.date,
      allDay: true,
      startTime: null,
      endTime: null,
      location: null,
      employee: { id: b.id, fullName: b.fullName },
      detail: null,
    })),
    ...events.map((e) => ({
      type: 'EVENT' as const,
      id: e.id,
      title: e.title,
      startDate: toDateOnly(e.startDate),
      endDate: toDateOnly(e.endDate),
      allDay: !e.startTime,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      employee: null,
      detail: e.description ? { description: e.description } : null,
    })),
    ...trainings.map((t) => ({
      type: 'TRAINING' as const,
      id: t.id,
      title: t.title,
      startDate: localDate(t.startAt, TIME_ZONE),
      endDate: localDate(t.endAt, TIME_ZONE),
      allDay: false,
      startTime: localTime(t.startAt),
      endTime: localTime(t.endAt),
      location: t.location,
      employee: null,
      detail: { category: t.category.name },
    })),
    ...leaves.map((l) => ({
      type: 'LEAVE' as const,
      id: l.id,
      title: q.master ? `${l.leaveType.name} — ${l.employee.fullName}` : l.leaveType.name,
      startDate: toDateOnly(l.startDate),
      endDate: toDateOnly(l.endDate),
      allDay: true,
      startTime: null,
      endTime: null,
      location: null,
      employee: l.employee,
      detail: { leaveType: l.leaveType.name, category: l.leaveType.category, status: l.status },
    })),
  ]

  items.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
      a.title.localeCompare(b.title, 'id'),
  )
  return items
}

// ---------------------------------------------------------------------------
// Event kantor (input hanya HR GA)
// ---------------------------------------------------------------------------

export interface EventInput {
  title?: string
  description?: string | null
  location?: string | null
  startDate?: string
  endDate?: string
  startTime?: string | null
  endTime?: string | null
  isActive?: boolean
}

function assertEventShape(e: { startDate: string; endDate: string; startTime: string | null; endTime: string | null }) {
  if (e.endDate < e.startDate) throw new HttpError(400, 'endDate tidak boleh sebelum startDate')
  if ((e.startTime === null) !== (e.endTime === null)) {
    throw new HttpError(400, 'startTime dan endTime diisi bersamaan (atau dikosongkan untuk sepanjang hari)')
  }
  if (e.startTime && e.endTime && e.startDate === e.endDate && e.endTime <= e.startTime) {
    throw new HttpError(400, 'endTime harus setelah startTime')
  }
}

function serializeEvent(e: Prisma.CalendarEventGetPayload<object>) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    startDate: toDateOnly(e.startDate),
    endDate: toDateOnly(e.endDate),
    startTime: e.startTime,
    endTime: e.endTime,
    allDay: !e.startTime,
    isActive: e.isActive,
  }
}

export async function createEvent(input: Required<Pick<EventInput, 'title' | 'startDate' | 'endDate'>> & EventInput, ctx: AuditContext) {
  const shape = {
    startDate: input.startDate,
    endDate: input.endDate,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
  }
  assertEventShape(shape)
  return prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        startDate: fromDateOnly(shape.startDate),
        endDate: fromDateOnly(shape.endDate),
        startTime: shape.startTime,
        endTime: shape.endTime,
      },
    })
    await recordAudit(tx, ctx, { action: 'calendar.event_create', entityType: 'calendar_event', entityId: event.id, changes: { after: event } })
    return serializeEvent(event)
  })
}

export async function updateEvent(id: string, input: EventInput, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.calendarEvent.findUnique({ where: { id } })
    if (!before) throw new HttpError(404, 'Event tidak ditemukan')
    const merged = {
      startDate: input.startDate ?? toDateOnly(before.startDate),
      endDate: input.endDate ?? toDateOnly(before.endDate),
      startTime: input.startTime !== undefined ? input.startTime : before.startTime,
      endTime: input.endTime !== undefined ? input.endTime : before.endTime,
    }
    assertEventShape(merged)
    const after = await tx.calendarEvent.update({
      where: { id },
      data: {
        ...input,
        ...(input.startDate ? { startDate: fromDateOnly(input.startDate) } : {}),
        ...(input.endDate ? { endDate: fromDateOnly(input.endDate) } : {}),
      },
    })
    await recordAudit(tx, ctx, {
      action: input.isActive === false && before.isActive ? 'calendar.event_deactivate' : 'calendar.event_update',
      entityType: 'calendar_event',
      entityId: id,
      changes: diffForAudit(before, after),
    })
    return serializeEvent(after)
  })
}
