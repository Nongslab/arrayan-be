import { z } from 'zod'
import { paginationQuery } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'

const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
const year = z.coerce.number().int().min(2000).max(2100)

export const leaveStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const createLeaveSchema = z
  .object({
    leaveTypeId: z.string().uuid('harus UUID'),
    startDate: dateOnly,
    endDate: dateOnly,
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, { message: 'endDate tidak boleh sebelum startDate', path: ['endDate'] })
  .refine(
    (v) => new Date(`${v.endDate}T00:00:00Z`).getTime() - new Date(`${v.startDate}T00:00:00Z`).getTime() <= 365 * 86_400_000,
    { message: 'rentang pengajuan maksimal 1 tahun', path: ['endDate'] },
  )

export type CreateLeaveInput = z.output<typeof createLeaveSchema>

export const cancelLeaveSchema = z
  .object({ reason: z.string().trim().min(3, 'minimal 3 karakter').max(500).optional() })
  .strict()

export const balanceQuerySchema = z.object({ year: year.optional().describe('Default tahun berjalan') })

export const myLeavesQuerySchema = z.object({
  year: year.optional(),
  status: leaveStatusSchema.optional(),
  ...paginationQuery,
})

export const leavesQuerySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid().optional(),
    status: leaveStatusSchema.optional(),
    from: dateOnly.optional().describe('Pengajuan yang mencakup tanggal ≥ from'),
    to: dateOnly.optional().describe('Pengajuan yang mencakup tanggal ≤ to'),
    ...paginationQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })

export const adjustmentSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    year,
    days: z
      .number()
      .int()
      .min(-365)
      .max(365)
      .refine((d) => d !== 0, 'tidak boleh 0'),
    reason: z.string().trim().min(3, 'minimal 3 karakter').max(500),
  })
  .strict()

export type AdjustmentInput = z.output<typeof adjustmentSchema>

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

const ref = z.object({ id: z.string(), code: z.string(), name: z.string() })

export const leaveRequestSchema = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), nik: z.string(), fullName: z.string() }),
  leaveType: ref.extend({ category: z.string() }),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number().int().describe('Hari kerja (hari kalender untuk cuti melahirkan)'),
  reason: z.string().nullable(),
  status: leaveStatusSchema,
  attachmentRequired: z
    .boolean()
    .describe('Jenis cuti ini mensyaratkan lampiran (unggah dokumen menyusul — US-2.8)'),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})

export const balanceItemSchema = z.object({
  leaveType: ref.extend({ category: z.string() }),
  year: z.number().int(),
  entitlement: z.number().int(),
  adjustments: z.number().int(),
  collectiveLeave: z.number().int().describe('Cuti bersama yang memotong cuti tahunan'),
  used: z.number().int().describe('Pengajuan APPROVED'),
  pending: z.number().int().describe('Pengajuan PENDING (dicadangkan)'),
  available: z.number().int(),
})
