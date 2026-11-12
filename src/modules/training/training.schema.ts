import { z } from 'zod'
import { paginationQuery } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'

const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
const instant = z.string().datetime({ offset: true, message: 'format ISO-8601 dengan zona waktu, mis. 2026-12-01T09:00:00+07:00' })
const MAX_DURATION_MS = 31 * 86_400_000

const trainingFields = {
  title: z.string().trim().min(3, 'minimal 3 karakter').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.string().uuid('harus UUID'),
  organizer: z.string().trim().max(200).nullable().optional().describe('Penyelenggara (internal / vendor)'),
  location: z.string().trim().max(300).nullable().optional(),
  startAt: instant,
  endAt: instant,
}

function validRange(v: { startAt?: string; endAt?: string }) {
  if (!v.startAt || !v.endAt) return true
  const start = Date.parse(v.startAt)
  const end = Date.parse(v.endAt)
  return end > start && end - start <= MAX_DURATION_MS
}
const rangeMessage = { message: 'endAt harus setelah startAt dan durasi maksimal 31 hari', path: ['endAt'] }

export const createTrainingSchema = z
  .object({
    ...trainingFields,
    participantIds: z.array(z.string().uuid()).max(500).optional().describe('Karyawan aktif peserta training'),
  })
  .strict()
  .refine(validRange, rangeMessage)

export const updateTrainingSchema = z
  .object({ ...trainingFields, status: z.enum(['SCHEDULED', 'CANCELLED']) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Body tidak boleh kosong')
  .refine(validRange, rangeMessage)

export const participantsSchema = z
  .object({ employeeIds: z.array(z.string().uuid()).max(500) })
  .strict()

export const attendanceMarkSchema = z.object({ attended: z.boolean() }).strict()

export const remarksSchema = z
  .object({
    remarks: z.string().trim().min(3, 'minimal 3 karakter').max(2000),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict()

export const listTrainingsQuerySchema = z
  .object({
    from: dateOnly.optional().describe('Training yang berlangsung pada/ setelah tanggal ini'),
    to: dateOnly.optional().describe('Training yang berlangsung pada/ sebelum tanggal ini'),
    categoryId: z.string().uuid().optional(),
    mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true').describe('Hanya training yang saya ikuti'),
    includeCancelled: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    ...paginationQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })

export const reportQuerySchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    categoryId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })

export type CreateTrainingInput = z.output<typeof createTrainingSchema>
export type UpdateTrainingInput = z.output<typeof updateTrainingSchema>
