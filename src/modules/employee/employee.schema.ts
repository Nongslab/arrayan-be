import { z } from 'zod'
import { paginationQuery } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'

export const employmentTypeSchema = z.enum(['PROBATION', 'KARTAP', 'PKL'])
export const employeeStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])
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
