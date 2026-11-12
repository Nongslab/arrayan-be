import { z } from 'zod'
import { paginationQuery } from '../../lib/route-helpers.js'

export const employmentTypeSchema = z.enum(['PROBATION', 'KARTAP', 'PKL'])
export const accountStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'NO_ACCOUNT'])
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
  accountStatus: accountStatusSchema.optional().describe('Status akun login karyawan'),
  ...paginationQuery,
})

export type EmployeeListQuery = z.output<typeof employeeListQuerySchema>

export const employeeTreeQuerySchema = z.object({
  rootId: z.string().uuid().optional().describe('Ambil subtree mulai dari karyawan ini'),
})

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
