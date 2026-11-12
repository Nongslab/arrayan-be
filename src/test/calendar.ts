import { prisma } from '../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../lib/dates.js'
import { todayInJakarta } from '../modules/employee/employee.schema.js'

/**
 * Senin minimal 14 hari sebelum hari ini (semua tanggal uji sudah lewat) yang minggunya
 * (Senin s.d. Senin berikutnya) bebas hari libur — agar test kehadiran tidak bergantung
 * pada tanggal CI berjalan.
 */
export async function pastMondayWithoutHolidays(): Promise<string> {
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { isActive: true }, select: { date: true } })).map((h) => toDateOnly(h.date)),
  )
  let d = addDays(fromDateOnly(todayInJakarta()), -14)
  for (;;) {
    while (d.getUTCDay() !== 1) d = addDays(d, -1)
    const week = Array.from({ length: 8 }, (_, i) => toDateOnly(addDays(d, i)))
    if (!week.some((date) => holidays.has(date))) return toDateOnly(d)
    d = addDays(d, -1)
  }
}
