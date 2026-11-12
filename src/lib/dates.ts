/** Utilitas tanggal kalender (yyyy-MM-dd, UTC) tanpa komponen jam. */

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * Tambah `months` bulan. Bila tanggal tidak ada di bulan tujuan, dibulatkan ke hari
 * terakhir bulan tersebut (31 Agu + 6 bulan → 28/29 Feb), bukan meluber ke bulan berikutnya.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTarget)))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}
