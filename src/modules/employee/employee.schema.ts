import { z } from 'zod'
import { paginationQuery } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'

export const employmentTypeSchema = z.enum(['PROBATION', 'KARTAP', 'PKL'])
export const employeeStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])
export const genderSchema = z.enum(['MALE', 'FEMALE'])
export const accountStatusSchema = z.enum(['ACTIVE', 'PENDING_ACTIVATION', 'DISABLED', 'NO_ACCOUNT'])
const hierarchyLevel = z.enum(['MANAGEMENT', 'SR_MANAGER', 'MANAGER', 'SUPERVISOR', 'STAFF'])

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().describe('Cari nama lengkap atau NIK (case-insensitive)'),
  departmentId: z.string().uuid().optional(),
  includeSubDepartments: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true')
    .describe('Bersama departmentId: sertakan karyawan di sub-departemen'),
  jobTitleId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional().describe('Bawahan langsung dari karyawan ini'),
  employmentType: employmentTypeSchema.optional(),
  status: z
    .enum(['ACTIVE', 'INACTIVE', 'ALL'])
    .default('ACTIVE')
    .describe('Status karyawan. Default ACTIVE; INACTIVE = karyawan keluar'),
  accountStatus: accountStatusSchema.optional().describe('Status akun login karyawan'),
  ...paginationQuery,
})

export type EmployeeListQuery = z.output<typeof employeeListQuerySchema>

export const employeeTreeQuerySchema = z.object({
  rootId: z.string().uuid().optional().describe('Ambil subtree mulai dari karyawan ini'),
})

const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
const optionalRef = z.string().uuid('harus UUID').nullable().optional()

/** Tanggal hari ini (yyyy-MM-dd) di zona waktu kantor default. */
export function todayInJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

const birthDateField = dateOnly
  .refine((value) => value >= '1900-01-01' && value <= todayInJakarta(), 'tidak boleh di masa depan atau sebelum 1900')
  .nullable()
  .optional()
  .describe('yyyy-MM-dd')
export const roleCodeSchema = z.enum(['SUPER_ADMIN', 'MANAGEMENT', 'SR_MANAGER', 'MANAGER', 'SUPERVISOR', 'STAFF'])

export const accountInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('format email tidak valid').max(254),
    roleCode: roleCodeSchema
      .optional()
      .describe('Default mengikuti level jabatan (mis. Direktur → MANAGEMENT). SUPER_ADMIN untuk tim HR'),
  })
  .strict()

const employeeFields = {
  nik: z
    .string()
    .trim()
    .min(3, 'minimal 3 karakter')
    .max(30, 'maksimal 30 karakter')
    .regex(/^[A-Za-z0-9._-]+$/, 'hanya huruf, angka, titik, garis bawah, atau strip'),
  fullName: z.string().trim().min(2, 'minimal 2 karakter').max(120),
  employmentType: employmentTypeSchema.optional().describe('Default PROBATION'),
  joinDate: dateOnly.optional().describe('yyyy-MM-dd. Default hari ini'),
  jobTitleId: z.string().uuid('harus UUID'),
  departmentId: optionalRef,
  officeLocationId: optionalRef,
  workShiftId: optionalRef,
  managerId: optionalRef.describe('Atasan langsung (karyawan aktif)'),
  // Data pribadi (US-2.7) — hanya terlihat oleh SUPER_ADMIN & karyawan ybs.
  birthDate: birthDateField,
  gender: genderSchema.nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,19}$/, 'format telepon tidak valid, mis. +62 812-3456-7890')
    .nullable()
    .optional(),
  personalEmail: z.string().trim().toLowerCase().email('format email tidak valid').max(254).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
}

export const createEmployeeSchema = z
  .object({
    ...employeeFields,
    account: accountInputSchema.optional().describe('Isi untuk langsung membuat akun & mengirim undangan aktivasi'),
  })
  .strict()

export const updateEmployeeSchema = z
  .object(employeeFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Body tidak boleh kosong')

export const employeeStatusInputSchema = z
  .object({
    status: employeeStatusSchema,
    exitDate: dateOnly.optional().describe('Tanggal keluar (hanya untuk INACTIVE). Default hari ini'),
  })
  .strict()
  .refine((value) => value.status === 'INACTIVE' || value.exitDate === undefined, {
    message: 'exitDate hanya untuk status INACTIVE',
    path: ['exitDate'],
  })

export type CreateEmployeeInput = z.output<typeof createEmployeeSchema>
export type UpdateEmployeeInput = z.output<typeof updateEmployeeSchema>
export type AccountInput = z.output<typeof accountInputSchema>
export type EmployeeStatusInput = z.output<typeof employeeStatusInputSchema>

// ---------------------------------------------------------------------------
// Response (dokumentasi Swagger + serializer)
// ---------------------------------------------------------------------------

const ref = z.object({ id: z.string(), code: z.string(), name: z.string() })
const jobTitle = ref.extend({ level: hierarchyLevel })

export const employeeSummarySchema = z.object({
  id: z.string(),
  nik: z.string(),
  fullName: z.string(),
  jobTitle,
})

export const employeeSchema = z.object({
  id: z.string(),
  nik: z.string(),
  fullName: z.string(),
  employmentType: employmentTypeSchema,
  joinDate: z.string().describe('ISO-8601'),
  status: employeeStatusSchema,
  exitDate: z.string().nullable().describe('yyyy-MM-dd, terisi bila INACTIVE'),
  jobTitle,
  department: ref.nullable(),
  officeLocation: ref.nullable(),
  workShift: ref.nullable(),
  managerId: z.string().nullable(),
  manager: employeeSummarySchema.nullable(),
  account: z
    .object({
      email: z.string(),
      role: z.object({ code: z.string(), name: z.string() }),
      status: accountStatusSchema,
    })
    .nullable(),
  accountStatus: accountStatusSchema,
  subordinateCount: z.number().int(),
  personal: z
    .object({
      birthDate: z.string().nullable(),
      gender: genderSchema.nullable(),
      phone: z.string().nullable(),
      personalEmail: z.string().nullable(),
      address: z.string().nullable(),
    })
    .nullable()
    .describe('Data pribadi — hanya untuk SUPER_ADMIN & karyawan ybs; null untuk yang lain'),
})

export const employeeDetailSchema = employeeSchema.extend({
  subordinates: z.array(employeeSummarySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Node pohon tanpa `children` (children ditambahkan manual karena rekursif). */
export const treeNodeBaseSchema = z.object({
  id: z.string(),
  nik: z.string(),
  fullName: z.string(),
  employmentType: employmentTypeSchema,
  managerId: z.string().nullable(),
  jobTitle,
  department: ref.nullable(),
})

export const invitationSchema = z.object({
  driver: z.string().describe('Kanal pengiriman undangan (saat ini `log`)'),
  expiresAt: z.string(),
  devActivationLink: z.string().optional().describe('Hanya di luar production — untuk uji coba tanpa email'),
})

export const birthdaysQuerySchema = z
  .object({
    from: dateOnly.optional().describe('Default hari ini (Asia/Jakarta)'),
    to: dateOnly.optional().describe('Default from + 30 hari'),
    departmentId: z.string().uuid().optional(),
  })
  .transform((q) => {
    const from = q.from ?? todayInJakarta()
    const to = q.to ?? new Date(new Date(`${from}T00:00:00.000Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
    return { from, to, departmentId: q.departmentId }
  })
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
  .refine(
    (q) => new Date(`${q.to}T00:00:00Z`).getTime() - new Date(`${q.from}T00:00:00Z`).getTime() <= 366 * 86_400_000,
    { message: 'rentang maksimal 366 hari', path: ['to'] },
  )

export const birthdayItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  jobTitle,
  department: ref.nullable(),
  birthday: z.string().describe('MM-dd (tanpa tahun lahir)'),
  date: z.string().describe('Tanggal ulang tahun di dalam rentang (yyyy-MM-dd)'),
})
