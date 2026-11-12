import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { diffForAudit, sanitizeForAudit } from './audit.js'

describe('audit helpers', () => {
  it('sanitizeForAudit membuang field sensitif (termasuk bersarang) dan menormalkan tipe', () => {
    const result = sanitizeForAudit({
      email: 'a@b.c',
      passwordHash: '$2b$10$rahasia',
      nested: { token: 'f'.repeat(64), refreshToken: 'x', keep: 1 },
      list: [{ password: 'p', name: 'n' }],
      weight: new Prisma.Decimal('33.33'),
      joinDate: new Date('2026-01-05T00:00:00.000Z'),
      missing: undefined,
    })
    expect(result).toEqual({
      email: 'a@b.c',
      nested: { keep: 1 },
      list: [{ name: 'n' }],
      weight: 33.33,
      joinDate: '2026-01-05T00:00:00.000Z',
      missing: null,
    })
  })

  it('diffForAudit hanya memuat field yang berubah, tanpa timestamp & field sensitif', () => {
    const before = { fullName: 'Lama', nik: 'A1', managerId: null, updatedAt: new Date(1), passwordHash: 'h1' }
    const after = { fullName: 'Baru', nik: 'A1', managerId: 'm-1', updatedAt: new Date(2), passwordHash: 'h2' }
    expect(diffForAudit(before, after)).toEqual({
      fullName: { from: 'Lama', to: 'Baru' },
      managerId: { from: null, to: 'm-1' },
    })
  })

  it('diffForAudit membandingkan array & objek berdasarkan isi', () => {
    expect(diffForAudit({ workDays: [1, 2, 3] }, { workDays: [1, 2, 3] })).toEqual({})
    expect(diffForAudit({ workDays: [1, 2] }, { workDays: [1, 2, 3] })).toEqual({
      workDays: { from: [1, 2], to: [1, 2, 3] },
    })
  })
})
