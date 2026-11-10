/**
 * Pembatas percobaan login gagal (anti brute-force) — SECURITY_GUIDELINES §2.3.
 *
 * Kunci = IP + email, sehingga karyawan yang berbagi IP kantor (NAT) tidak saling
 * mengunci akun. Hanya percobaan GAGAL yang dihitung; login sukses mereset hitungan.
 * Disimpan in-memory karena backend berjalan sebagai satu instance (self-hosted).
 */

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000

interface AttemptRecord {
  count: number
  windowStart: number
}

export function createLoginLimiter(
  maxAttempts = MAX_FAILED_ATTEMPTS,
  windowMs = LOCKOUT_WINDOW_MS,
  now: () => number = Date.now,
) {
  const attempts = new Map<string, AttemptRecord>()

  const keyOf = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`

  function activeRecord(key: string): AttemptRecord | undefined {
    const record = attempts.get(key)
    if (record && now() - record.windowStart >= windowMs) {
      attempts.delete(key)
      return undefined
    }
    return record
  }

  return {
    /** Sisa detik lockout, atau 0 jika boleh mencoba login. */
    retryAfterSeconds(ip: string, email: string): number {
      const record = activeRecord(keyOf(ip, email))
      if (!record || record.count < maxAttempts) return 0
      return Math.ceil((record.windowStart + windowMs - now()) / 1000)
    },

    recordFailure(ip: string, email: string): void {
      const key = keyOf(ip, email)
      const record = activeRecord(key)
      if (record) {
        record.count += 1
      } else {
        attempts.set(key, { count: 1, windowStart: now() })
      }
    },

    reset(ip: string, email: string): void {
      attempts.delete(keyOf(ip, email))
    },
  }
}

export const loginLimiter = createLoginLimiter()
