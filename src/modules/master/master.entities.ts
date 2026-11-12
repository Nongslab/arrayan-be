import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import type { AuditDb } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import {
  BSSID_PATTERN,
  CODE_PATTERN,
  TIME_PATTERN,
  checkKpiIndicators,
  checkWorkShift,
  hasAtMostTwoDecimals,
  isValidDateOnly,
  isValidTimezone,
  wouldCreateDepartmentCycle,
} from './master.rules.js'

// ---------------------------------------------------------------------------
// Tipe konfigurasi
// ---------------------------------------------------------------------------

/** Subset delegate Prisma yang dipakai route generik. */
export interface MasterDelegate {
  findMany(args: object): Promise<unknown[]>
  count(args: object): Promise<number>
  findUnique(args: object): Promise<unknown | null>
  create(args: object): Promise<unknown>
  update(args: object): Promise<unknown>
}

type AnyObject = Record<string, unknown>
type ZodObj = z.ZodObject<z.ZodRawShape>

export interface MasterEntityConfig {
  /** Segmen URL: /api/master/<path> */
  path: string
  /** Nama tampil (Swagger tag & pesan). */
  label: string
  /** Nama entitas untuk audit log, mis. "department" → aksi "master.department.update". */
  auditEntity: string
  /** Delegate Prisma; terima klien transaksi agar audit ditulis atomik bersama aksinya. */
  delegate: (db?: AuditDb) => MasterDelegate
  /** Field input (tanpa isActive). `code` wajib ada; dibuang otomatis pada update. */
  fields: z.ZodRawShape
  /** Bentuk response satu item (dokumentasi Swagger + serializer). */
  response: ZodObj
  serialize: (row: never) => AnyObject
  include?: object
  orderBy: object | object[]
  /** Filter list tambahan (querystring) di luar q/includeInactive/page/limit. */
  extraQuery?: z.ZodRawShape
  extraWhere?: (query: AnyObject) => object
  /** Ubah input tervalidasi menjadi `data` Prisma. */
  toData?: (input: AnyObject, mode: 'create' | 'update') => object
  /** Aturan lintas-field atas data gabungan (existing + patch). Kembalikan pesan error atau null. */
  check?: (merged: AnyObject, patch: AnyObject) => string | null
  /** Aturan yang butuh query DB (mis. siklus departemen). Lempar HttpError bila gagal. */
  beforeWrite?: (ctx: { id?: string; input: AnyObject }) => Promise<void>
  /** Contoh body POST untuk Swagger. */
  example: AnyObject
}

// ---------------------------------------------------------------------------
// Field & serializer bersama
// ---------------------------------------------------------------------------

const codeField = z
  .string()
  .trim()
  .min(2, 'minimal 2 karakter')
  .max(40, 'maksimal 40 karakter')
  .regex(CODE_PATTERN, 'harus UPPER_SNAKE_CASE, mis. FIN atau HR_GA')
const nameField = z.string().trim().min(2, 'minimal 2 karakter').max(120, 'maksimal 120 karakter')
const optionalText = z.string().trim().max(500).nullable().optional()
const uuidRef = z.string().uuid('harus UUID').nullable().optional()

const baseResponse = {
  id: z.string(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().describe('ISO-8601'),
  updatedAt: z.string().describe('ISO-8601'),
}

const refSummary = z.object({ id: z.string(), code: z.string(), name: z.string() })

interface BaseRow {
  id: string
  code: string
  name: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function serializeBase(row: BaseRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const toNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value))
const summary = (ref: { id: string; code: string; name: string } | null) =>
  ref ? { id: ref.id, code: ref.code, name: ref.name } : null

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

type DepartmentRow = BaseRow & {
  description: string | null
  parentId: string | null
  parent: { id: string; code: string; name: string } | null
}

const department: MasterEntityConfig = {
  path: 'departments',
  label: 'Departemen',
  auditEntity: 'department',
  delegate: (db = prisma) => db.department as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    description: optionalText,
    parentId: uuidRef.describe('Departemen induk (null = root)'),
  },
  response: z.object({
    ...baseResponse,
    description: z.string().nullable(),
    parentId: z.string().nullable(),
    parent: refSummary.nullable(),
  }),
  serialize: (row: DepartmentRow) => ({
    ...serializeBase(row),
    description: row.description,
    parentId: row.parentId,
    parent: summary(row.parent),
  }),
  include: { parent: { select: { id: true, code: true, name: true } } },
  orderBy: { name: 'asc' },
  extraQuery: { parentId: z.string().uuid().optional() },
  extraWhere: (q) => (q.parentId ? { parentId: q.parentId } : {}),
  async beforeWrite({ id, input }) {
    const parentId = input.parentId as string | null | undefined
    if (!parentId) return

    const all = await prisma.department.findMany({ select: { id: true, parentId: true, isActive: true } })
    const parent = all.find((d) => d.id === parentId)
    if (!parent) throw new HttpError(422, 'parentId: departemen induk tidak ditemukan')
    if (!parent.isActive) throw new HttpError(422, 'parentId: departemen induk tidak aktif')
    if (id) {
      const parentOf = new Map(all.map((d) => [d.id, d.parentId]))
      if (wouldCreateDepartmentCycle(parentOf, id, parentId)) {
        throw new HttpError(422, 'parentId: membentuk siklus hierarki departemen')
      }
    }
  },
  example: { code: 'ENG_FE', name: 'Frontend Engineering', description: 'Sub-divisi Engineering', parentId: null },
}

// ---------------------------------------------------------------------------
// Job Title
// ---------------------------------------------------------------------------

const hierarchyLevel = z.enum(['MANAGEMENT', 'SR_MANAGER', 'MANAGER', 'SUPERVISOR', 'STAFF'])

type JobTitleRow = BaseRow & { level: string; description: string | null }

const jobTitle: MasterEntityConfig = {
  path: 'job-titles',
  label: 'Jabatan',
  auditEntity: 'job_title',
  delegate: (db = prisma) => db.jobTitle as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    level: hierarchyLevel,
    description: optionalText,
  },
  response: z.object({ ...baseResponse, level: hierarchyLevel, description: z.string().nullable() }),
  serialize: (row: JobTitleRow) => ({ ...serializeBase(row), level: row.level, description: row.description }),
  orderBy: [{ level: 'asc' }, { name: 'asc' }],
  extraQuery: { level: hierarchyLevel.optional() },
  extraWhere: (q) => (q.level ? { level: q.level } : {}),
  example: { code: 'SR_ENGINEER', name: 'Senior Engineer', level: 'STAFF' },
}

// ---------------------------------------------------------------------------
// Office Location
// ---------------------------------------------------------------------------

type OfficeLocationRow = BaseRow & {
  address: string | null
  latitude: Prisma.Decimal
  longitude: Prisma.Decimal
  radiusMeters: number
  wifiSsids: string[]
  wifiBssids: string[]
  timezone: string
}

const officeLocation: MasterEntityConfig = {
  path: 'office-locations',
  label: 'Lokasi Kantor',
  auditEntity: 'office_location',
  delegate: (db = prisma) => db.officeLocation as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    address: optionalText,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(1).max(10_000).optional(),
    wifiSsids: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    wifiBssids: z
      .array(z.string().trim().toUpperCase().regex(BSSID_PATTERN, 'format MAC AA:BB:CC:DD:EE:FF'))
      .max(20)
      .optional(),
    timezone: z.string().refine(isValidTimezone, 'timezone IANA tidak dikenal, mis. Asia/Jakarta').optional(),
  },
  response: z.object({
    ...baseResponse,
    address: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    radiusMeters: z.number().int(),
    wifiSsids: z.array(z.string()),
    wifiBssids: z.array(z.string()),
    timezone: z.string(),
  }),
  serialize: (row: OfficeLocationRow) => ({
    ...serializeBase(row),
    address: row.address,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: row.radiusMeters,
    wifiSsids: row.wifiSsids,
    wifiBssids: row.wifiBssids,
    timezone: row.timezone,
  }),
  orderBy: { name: 'asc' },
  example: {
    code: 'BR_BDG',
    name: 'Kantor Cabang Bandung',
    address: 'Jl. Asia Afrika No. 1, Bandung',
    latitude: -6.921553,
    longitude: 107.607064,
    radiusMeters: 150,
    wifiSsids: ['Arryan-Office'],
    wifiBssids: ['AA:BB:CC:DD:EE:FF'],
    timezone: 'Asia/Jakarta',
  },
}

// ---------------------------------------------------------------------------
// Work Shift
// ---------------------------------------------------------------------------

type WorkShiftRow = BaseRow & {
  startTime: string
  endTime: string
  breakMinutes: number
  lateToleranceMinutes: number
  workDays: number[]
  isOvernight: boolean
}

const timeField = z.string().regex(TIME_PATTERN, 'format HH:mm (00:00–23:59)')

const workShift: MasterEntityConfig = {
  path: 'work-shifts',
  label: 'Shift Kerja',
  auditEntity: 'work_shift',
  delegate: (db = prisma) => db.workShift as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    startTime: timeField,
    endTime: timeField,
    breakMinutes: z.number().int().min(0).max(240).optional(),
    lateToleranceMinutes: z.number().int().min(0).max(240).optional(),
    workDays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'hari kerja tidak boleh duplikat')
      .transform((days) => [...days].sort((a, b) => a - b))
      .describe('ISO-8601: 1 = Senin … 7 = Minggu')
      .optional(),
    isOvernight: z.boolean().optional(),
  },
  response: z.object({
    ...baseResponse,
    startTime: z.string(),
    endTime: z.string(),
    breakMinutes: z.number().int(),
    lateToleranceMinutes: z.number().int(),
    workDays: z.array(z.number().int()),
    isOvernight: z.boolean(),
  }),
  serialize: (row: WorkShiftRow) => ({
    ...serializeBase(row),
    startTime: row.startTime,
    endTime: row.endTime,
    breakMinutes: row.breakMinutes,
    lateToleranceMinutes: row.lateToleranceMinutes,
    workDays: row.workDays,
    isOvernight: row.isOvernight,
  }),
  orderBy: { startTime: 'asc' },
  check: (merged) =>
    checkWorkShift({
      startTime: merged.startTime as string,
      endTime: merged.endTime as string,
      isOvernight: Boolean(merged.isOvernight),
    }),
  example: {
    code: 'NIGHT',
    name: 'Shift Malam',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 60,
    lateToleranceMinutes: 15,
    workDays: [1, 2, 3, 4, 5],
    isOvernight: true,
  },
}

// ---------------------------------------------------------------------------
// Leave Type
// ---------------------------------------------------------------------------

const leaveCategory = z.enum(['ANNUAL', 'SICK', 'PERMISSION', 'MATERNITY', 'SPECIAL', 'UNPAID'])

type LeaveTypeRow = BaseRow & {
  category: string
  defaultQuota: number
  isPaid: boolean
  requiresAttachment: boolean
  deductsAnnualLeave: boolean
}

const leaveType: MasterEntityConfig = {
  path: 'leave-types',
  label: 'Jenis Cuti',
  auditEntity: 'leave_type',
  delegate: (db = prisma) => db.leaveType as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    category: leaveCategory,
    defaultQuota: z.number().int().min(0).max(365).describe('Hari per tahun; 0 = tanpa kuota').optional(),
    isPaid: z.boolean().optional(),
    requiresAttachment: z.boolean().optional(),
    deductsAnnualLeave: z.boolean().optional(),
  },
  response: z.object({
    ...baseResponse,
    category: leaveCategory,
    defaultQuota: z.number().int(),
    isPaid: z.boolean(),
    requiresAttachment: z.boolean(),
    deductsAnnualLeave: z.boolean(),
  }),
  serialize: (row: LeaveTypeRow) => ({
    ...serializeBase(row),
    category: row.category,
    defaultQuota: row.defaultQuota,
    isPaid: row.isPaid,
    requiresAttachment: row.requiresAttachment,
    deductsAnnualLeave: row.deductsAnnualLeave,
  }),
  orderBy: { name: 'asc' },
  extraQuery: { category: leaveCategory.optional() },
  extraWhere: (q) => (q.category ? { category: q.category } : {}),
  example: {
    code: 'MARRIAGE',
    name: 'Cuti Menikah',
    category: 'SPECIAL',
    defaultQuota: 3,
    isPaid: true,
    requiresAttachment: true,
    deductsAnnualLeave: false,
  },
}

// ---------------------------------------------------------------------------
// Holiday
// ---------------------------------------------------------------------------

const holidayKind = z.enum(['NATIONAL', 'COLLECTIVE_LEAVE', 'COMPANY'])

type HolidayRow = BaseRow & { date: Date; kind: string }

const holiday: MasterEntityConfig = {
  path: 'holidays',
  label: 'Hari Libur',
  auditEntity: 'holiday',
  delegate: (db = prisma) => db.holiday as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    date: z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid'),
    kind: holidayKind,
  },
  response: z.object({ ...baseResponse, date: z.string().describe('yyyy-MM-dd'), kind: holidayKind }),
  serialize: (row: HolidayRow) => ({
    ...serializeBase(row),
    date: row.date.toISOString().slice(0, 10),
    kind: row.kind,
  }),
  orderBy: { date: 'asc' },
  extraQuery: {
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    kind: holidayKind.optional(),
  },
  extraWhere: (q) => ({
    ...(q.year
      ? { date: { gte: new Date(`${q.year}-01-01T00:00:00.000Z`), lt: new Date(`${Number(q.year) + 1}-01-01T00:00:00.000Z`) } }
      : {}),
    ...(q.kind ? { kind: q.kind } : {}),
  }),
  toData: (input) => ({
    ...input,
    ...(typeof input.date === 'string' ? { date: new Date(`${input.date}T00:00:00.000Z`) } : {}),
  }),
  example: { code: 'COMPANY_ANNIV_2027', name: 'Ulang Tahun Perusahaan', date: '2027-03-10', kind: 'COMPANY' },
}

// ---------------------------------------------------------------------------
// Training Category
// ---------------------------------------------------------------------------

type TrainingCategoryRow = BaseRow & { description: string | null }

const trainingCategory: MasterEntityConfig = {
  path: 'training-categories',
  label: 'Kategori Training',
  auditEntity: 'training_category',
  delegate: (db = prisma) => db.trainingCategory as unknown as MasterDelegate,
  fields: { code: codeField, name: nameField, description: optionalText },
  response: z.object({ ...baseResponse, description: z.string().nullable() }),
  serialize: (row: TrainingCategoryRow) => ({ ...serializeBase(row), description: row.description }),
  orderBy: { name: 'asc' },
  example: { code: 'SOFT_SKILL', name: 'Soft Skill', description: 'Komunikasi, kepemimpinan, dll.' },
}

// ---------------------------------------------------------------------------
// KPI Template (+ indikator nested)
// ---------------------------------------------------------------------------

const kpiPeriod = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY'])
const kpiIndicatorType = z.enum(['QUANTITATIVE', 'QUALITATIVE'])

const kpiIndicatorInput = z
  .object({
    name: nameField,
    description: optionalText,
    type: kpiIndicatorType,
    weight: z.number().positive().max(100).refine(hasAtMostTwoDecimals, 'maksimal 2 angka desimal'),
    target: z.number().nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict()

type KpiIndicatorInput = z.infer<typeof kpiIndicatorInput>

type KpiTemplateRow = BaseRow & {
  description: string | null
  period: string
  jobTitleId: string | null
  departmentId: string | null
  jobTitle: { id: string; code: string; name: string } | null
  department: { id: string; code: string; name: string } | null
  indicators: Array<{
    id: string
    name: string
    description: string | null
    type: string
    weight: Prisma.Decimal
    target: Prisma.Decimal | null
    unit: string | null
    sortOrder: number
  }>
}

const toIndicatorCreate = (indicators: KpiIndicatorInput[]) =>
  indicators.map((indicator, index) => ({ ...indicator, sortOrder: indicator.sortOrder ?? index }))

const kpiTemplate: MasterEntityConfig = {
  path: 'kpi-templates',
  label: 'Template KPI',
  auditEntity: 'kpi_template',
  delegate: (db = prisma) => db.kpiTemplate as unknown as MasterDelegate,
  fields: {
    code: codeField,
    name: nameField,
    description: optionalText,
    period: kpiPeriod.optional(),
    jobTitleId: uuidRef.describe('Berlaku untuk jabatan ini (opsional)'),
    departmentId: uuidRef.describe('Berlaku untuk departemen ini (opsional)'),
    indicators: z.array(kpiIndicatorInput).min(1).max(50).describe('Pada PATCH, daftar ini menggantikan seluruh indikator'),
  },
  response: z.object({
    ...baseResponse,
    description: z.string().nullable(),
    period: kpiPeriod,
    jobTitleId: z.string().nullable(),
    departmentId: z.string().nullable(),
    jobTitle: refSummary.nullable(),
    department: refSummary.nullable(),
    indicators: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        type: kpiIndicatorType,
        weight: z.number(),
        target: z.number().nullable(),
        unit: z.string().nullable(),
        sortOrder: z.number().int(),
      }),
    ),
  }),
  serialize: (row: KpiTemplateRow) => ({
    ...serializeBase(row),
    description: row.description,
    period: row.period,
    jobTitleId: row.jobTitleId,
    departmentId: row.departmentId,
    jobTitle: summary(row.jobTitle),
    department: summary(row.department),
    indicators: row.indicators.map((indicator) => ({
      id: indicator.id,
      name: indicator.name,
      description: indicator.description,
      type: indicator.type,
      weight: Number(indicator.weight),
      target: toNumber(indicator.target),
      unit: indicator.unit,
      sortOrder: indicator.sortOrder,
    })),
  }),
  include: {
    jobTitle: { select: { id: true, code: true, name: true } },
    department: { select: { id: true, code: true, name: true } },
    indicators: { orderBy: { sortOrder: 'asc' } },
  },
  orderBy: { name: 'asc' },
  extraQuery: {
    jobTitleId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
  },
  extraWhere: (q) => ({
    ...(q.jobTitleId ? { jobTitleId: q.jobTitleId } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
  }),
  check: (_merged, patch) =>
    patch.indicators ? checkKpiIndicators(patch.indicators as KpiIndicatorInput[]) : null,
  toData: (input, mode) => {
    const { indicators, ...rest } = input as AnyObject & { indicators?: KpiIndicatorInput[] }
    if (!indicators) return rest
    const create = toIndicatorCreate(indicators)
    return {
      ...rest,
      indicators: mode === 'create' ? { create } : { deleteMany: {}, create },
    }
  },
  example: {
    code: 'ENG_QUARTERLY',
    name: 'KPI Engineering Kuartalan',
    period: 'QUARTERLY',
    jobTitleId: null,
    departmentId: null,
    indicators: [
      { name: 'Story point selesai', type: 'QUANTITATIVE', weight: 50, target: 40, unit: 'poin' },
      { name: 'Bug produksi', type: 'QUANTITATIVE', weight: 30, target: 2, unit: 'bug' },
      { name: 'Kolaborasi tim', type: 'QUALITATIVE', weight: 20 },
    ],
  },
}

export const MASTER_ENTITIES: MasterEntityConfig[] = [
  department,
  jobTitle,
  officeLocation,
  workShift,
  leaveType,
  holiday,
  trainingCategory,
  kpiTemplate,
]
