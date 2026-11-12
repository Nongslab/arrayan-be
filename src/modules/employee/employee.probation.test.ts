import { describe, expect, it } from 'vitest'
import { fromDateOnly as d, toDateOnly } from '../../lib/dates.js'
import { resolveProbationEnd } from './employee.probation.js'

const value = (result: ReturnType<typeof resolveProbationEnd>) => {
  if (!result.ok) throw new Error(result.message)
  return result.value === undefined ? 'unchanged' : result.value === null ? null : toDateOnly(result.value)
}

describe('resolveProbationEnd', () => {
  describe('create', () => {
    it('PROBATION default joinDate + 6 bulan', () => {
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-08-31'), requested: undefined }))).toBe('2027-02-28')
    })

    it('bukan PROBATION → null', () => {
      expect(value(resolveProbationEnd({ employmentType: 'KARTAP', joinDate: d('2026-01-01'), requested: undefined }))).toBeNull()
    })

    it('nilai manual diterima bila setelah joinDate', () => {
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-01-01'), requested: d('2026-04-01') }))).toBe('2026-04-01')
    })

    it('menolak nilai manual tidak valid', () => {
      expect(resolveProbationEnd({ employmentType: 'KARTAP', joinDate: d('2026-01-01'), requested: d('2026-04-01') })).toMatchObject({ ok: false })
      expect(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-01-01'), requested: d('2025-12-31') })).toMatchObject({ ok: false })
      expect(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-01-01'), requested: null })).toMatchObject({ ok: false })
    })
  })

  describe('update', () => {
    const before = { joinDate: d('2026-01-10'), probationEndDate: d('2026-07-10') }

    it('joinDate berubah & nilai lama masih default → dihitung ulang', () => {
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-02-01'), requested: undefined, before }))).toBe('2026-08-01')
    })

    it('nilai manual HR dipertahankan saat joinDate berubah', () => {
      const manual = { joinDate: d('2026-01-10'), probationEndDate: d('2026-05-01') }
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-02-01'), requested: undefined, before: manual }))).toBe('unchanged')
    })

    it('tidak ada perubahan → tidak diubah', () => {
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-01-10'), requested: undefined, before }))).toBe('unchanged')
    })

    it('diangkat KARTAP → tanggal lama disimpan sebagai riwayat', () => {
      expect(value(resolveProbationEnd({ employmentType: 'KARTAP', joinDate: d('2026-01-10'), requested: undefined, before }))).toBe('unchanged')
    })

    it('KARTAP kembali PROBATION tanpa tanggal → dihitung', () => {
      const wasPermanent = { joinDate: d('2026-01-10'), probationEndDate: null }
      expect(value(resolveProbationEnd({ employmentType: 'PROBATION', joinDate: d('2026-01-10'), requested: undefined, before: wasPermanent }))).toBe('2026-07-10')
    })
  })
})
