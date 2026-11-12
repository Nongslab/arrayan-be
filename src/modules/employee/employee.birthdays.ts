/**
 * Ulang tahun karyawan dalam rentang tanggal (US-2.7, sumber widget "Birthday Hari Ini").
 * Fungsi murni → mudah di-unit-test. Tahun lahir tidak pernah dikeluarkan (privasi).
 */

export interface BirthdaySource {
  birthDate: Date
}

export interface BirthdayOccurrence<T> {
  employee: T
  /** Tanggal ulang tahun yang jatuh di dalam rentang (yyyy-MM-dd). */
  date: string
  /** Bulan-tanggal lahir (MM-dd) tanpa tahun. */
  birthday: string
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Tanggal ulang tahun pada `year`; 29 Feb dirayakan 28 Feb di tahun non-kabisat. */
export function birthdayInYear(birthDate: Date, year: number): string {
  const month = birthDate.getUTCMonth() + 1
  let day = birthDate.getUTCDate()
  if (month === 2 && day === 29 && !isLeapYear(year)) day = 28
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Semua ulang tahun dalam [from, to] (inklusif, yyyy-MM-dd), diurutkan per tanggal.
 * Mendukung rentang yang melewati pergantian tahun.
 */
export function birthdaysInRange<T extends BirthdaySource>(
  rows: readonly T[],
  from: string,
  to: string,
): BirthdayOccurrence<T>[] {
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  const result: BirthdayOccurrence<T>[] = []

  for (const employee of rows) {
    for (let year = fromYear; year <= toYear; year++) {
      const date = birthdayInYear(employee.birthDate, year)
      if (date >= from && date <= to) {
        result.push({
          employee,
          date,
          birthday: `${pad(employee.birthDate.getUTCMonth() + 1)}-${pad(employee.birthDate.getUTCDate())}`,
        })
      }
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}
