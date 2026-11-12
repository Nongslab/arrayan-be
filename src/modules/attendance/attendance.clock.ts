import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { distanceMeters, ipInRanges, normalizeIp } from '../../lib/geo.js'
import { localDate, shiftWindow, type ShiftRule } from './attendance.engine.js'
import { attendanceDays, FALLBACK_SHIFT } from './attendance.service.js'
import { serializeLog } from './attendance.corrections.js'

const DEFAULT_TIME_ZONE = 'Asia/Jakarta'

export interface ClockInput {
  latitude?: number
  longitude?: number
  accuracyMeters?: number
}

function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant)
}

/** Tanggal shift tempat `now` berada (hari ini, atau kemarin untuk shift malam yang belum selesai). */
export function shiftDateFor(now: Date, shift: ShiftRule, timeZone: string): string {
  const today = localDate(now, timeZone)
  const yesterday = toDateOnly(addDays(fromDateOnly(today), -1))
  for (const date of [today, yesterday]) {
    const window = shiftWindow(date, shift, timeZone)
    if (now >= window.start && now <= window.end) return date
  }
  return today
}

/**
 * US-3.2: clock-in / clock-out dari aplikasi. Lokasi diverifikasi lewat GPS (di dalam radius
 * kantor) atau IP internet kantor (allowlist). Maks. satu IN dan satu OUT per shift; waktu dari server.
 */
export async function clock(kind: 'IN' | 'OUT', employeeId: string, input: ClockInput, ip: string, now = new Date()) {
  const result = await prisma.$transaction(async (tx) => {
    // Serialkan per karyawan agar tombol yang ditekan dua kali tidak menghasilkan dua log.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`clock:${employeeId}`}))`

    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        status: true,
        workShift: { select: { startTime: true, endTime: true, lateToleranceMinutes: true, workDays: true, isOvernight: true } },
        officeLocation: {
          select: { name: true, latitude: true, longitude: true, radiusMeters: true, allowedIpRanges: true, timezone: true, isActive: true },
        },
      },
    })
    if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')
    if (employee.status !== 'ACTIVE') throw new HttpError(422, 'Karyawan tidak aktif')
    const office = employee.officeLocation
    if (!office) throw new HttpError(422, 'Lokasi kantor Anda belum diatur. Hubungi HR.')
    if (!office.isActive) throw new HttpError(422, 'Lokasi kantor Anda tidak aktif. Hubungi HR.')

    // --- Verifikasi lokasi ---
    const hasGps = input.latitude !== undefined && input.longitude !== undefined
    const distance = hasGps
      ? Math.round(
          distanceMeters(
            { latitude: input.latitude!, longitude: input.longitude! },
            { latitude: Number(office.latitude), longitude: Number(office.longitude) },
          ),
        )
      : null
    let verification: 'GPS' | 'IP_ALLOWLIST'
    if (distance !== null && distance <= office.radiusMeters) verification = 'GPS'
    else if (ipInRanges(ip, office.allowedIpRanges)) verification = 'IP_ALLOWLIST'
    else if (distance !== null) {
      throw new HttpError(422, `Di luar radius ${office.name}: jarak ${distance} m, maksimal ${office.radiusMeters} m`)
    } else {
      throw new HttpError(422, 'Lokasi tidak terverifikasi: kirim koordinat GPS atau gunakan jaringan internet kantor')
    }

    // --- Satu IN & satu OUT per shift ---
    const shift: ShiftRule = employee.workShift ?? FALLBACK_SHIFT
    const timeZone = office.timezone ?? DEFAULT_TIME_ZONE
    const shiftDate = shiftDateFor(now, shift, timeZone)
    const window = shiftWindow(shiftDate, shift, timeZone)
    const existing = await tx.attendanceLog.findMany({
      where: { employeeId, voidedAt: null, occurredAt: { gte: window.start, lte: window.end } },
      select: { occurredAt: true, kind: true },
      orderBy: { occurredAt: 'asc' },
    })
    if (kind === 'IN' && existing.length > 0) {
      throw new HttpError(409, `Anda sudah tercatat masuk pukul ${localTime(existing[0]!.occurredAt, timeZone)}`)
    }
    if (kind === 'OUT') {
      if (existing.length === 0) throw new HttpError(409, 'Anda belum clock-in pada shift ini')
      const out = existing.find((log) => log.kind === 'OUT')
      if (out) throw new HttpError(409, `Anda sudah clock-out pukul ${localTime(out.occurredAt, timeZone)}`)
    }

    const log = await tx.attendanceLog.create({
      data: {
        employeeId,
        occurredAt: now,
        source: 'APP',
        kind,
        verification,
        latitude: hasGps ? input.latitude : null,
        longitude: hasGps ? input.longitude : null,
        accuracyMeters: input.accuracyMeters ?? null,
        ip: normalizeIp(ip),
      },
      select: {
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
      },
    })
    return { log, shiftDate, verification, distance }
  })

  const [day] = await attendanceDays(employeeId, result.shiftDate, result.shiftDate, now)
  return {
    log: serializeLog(result.log),
    kind,
    shiftDate: result.shiftDate,
    verification: result.verification,
    distanceMeters: result.distance,
    day: day ?? null,
  }
}
