/**
 * Data awal Master Data Arryan HRIS.
 *
 * Sumber: mock frontend (arrayan-proj/src/mocks/data.ts) + default umum.
 * Semua entri di-upsert berdasarkan `code` sehingga aman dijalankan ulang.
 * Nilai bertanda PLACEHOLDER wajib diganti dengan data riil klien sebelum go-live.
 */
import type { HierarchyLevel, HolidayKind, KpiIndicatorType, KpiPeriod, LeaveCategory } from '@prisma/client'

export interface DepartmentSeed {
  code: string
  name: string
  description?: string
  parentCode?: string
}

/** Urutan penting: parent harus muncul sebelum child. */
export const DEPARTMENTS: DepartmentSeed[] = [
  { code: 'HQ', name: 'Arryan HQ', description: 'Induk organisasi (root tree branch)' },
  { code: 'ENG', name: 'Engineering', parentCode: 'HQ' },
  { code: 'HRD', name: 'People & Culture', description: 'HR GA', parentCode: 'HQ' },
  { code: 'FIN', name: 'Finance', parentCode: 'HQ' },
  { code: 'OPS', name: 'Operations', parentCode: 'HQ' },
]

export interface JobTitleSeed {
  code: string
  name: string
  level: HierarchyLevel
  description?: string
}

export const JOB_TITLES: JobTitleSeed[] = [
  { code: 'DIRECTOR', name: 'Direktur', level: 'MANAGEMENT' },
  { code: 'SR_MANAGER', name: 'Senior Manager', level: 'SR_MANAGER' },
  { code: 'MANAGER', name: 'Manager', level: 'MANAGER' },
  { code: 'SUPERVISOR', name: 'Supervisor', level: 'SUPERVISOR' },
  { code: 'STAFF', name: 'Staff', level: 'STAFF' },
  // Kode sama dengan hasil backfill migrasi dari jabatan free-text lama "HR & System Admin"
  { code: 'HR_SYSTEM_ADMIN', name: 'HR & System Admin', level: 'STAFF' },
  { code: 'INTERN', name: 'Intern / PKL', level: 'STAFF' },
]

export interface OfficeLocationSeed {
  code: string
  name: string
  address?: string
  latitude: number
  longitude: number
  radiusMeters: number
  wifiSsids: string[]
  wifiBssids: string[]
  timezone: string
}

export const OFFICE_LOCATIONS: OfficeLocationSeed[] = [
  {
    code: 'HO',
    name: 'Kantor Pusat',
    // PLACEHOLDER — koordinat Monas, Jakarta. Ganti dengan koordinat & Wi-Fi kantor klien.
    address: 'Jakarta',
    latitude: -6.175392,
    longitude: 106.827153,
    radiusMeters: 100,
    wifiSsids: [],
    wifiBssids: [],
    timezone: 'Asia/Jakarta',
  },
]

export interface WorkShiftSeed {
  code: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  lateToleranceMinutes: number
  workDays: number[]
  isOvernight: boolean
}

export const WORK_SHIFTS: WorkShiftSeed[] = [
  {
    code: 'REGULAR',
    name: 'Reguler (08:00–17:00)',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    lateToleranceMinutes: 15,
    workDays: [1, 2, 3, 4, 5],
    isOvernight: false,
  },
]

export interface LeaveTypeSeed {
  code: string
  name: string
  category: LeaveCategory
  defaultQuota: number
  isPaid: boolean
  requiresAttachment: boolean
  deductsAnnualLeave: boolean
}

export const LEAVE_TYPES: LeaveTypeSeed[] = [
  { code: 'ANNUAL', name: 'Cuti Tahunan', category: 'ANNUAL', defaultQuota: 12, isPaid: true, requiresAttachment: false, deductsAnnualLeave: true },
  { code: 'SICK', name: 'Izin Sakit', category: 'SICK', defaultQuota: 6, isPaid: true, requiresAttachment: true, deductsAnnualLeave: false },
  { code: 'MATERNITY', name: 'Cuti Melahirkan', category: 'MATERNITY', defaultQuota: 90, isPaid: true, requiresAttachment: true, deductsAnnualLeave: false },
  { code: 'PERMISSION', name: 'Izin', category: 'PERMISSION', defaultQuota: 0, isPaid: true, requiresAttachment: false, deductsAnnualLeave: false },
  { code: 'UNPAID', name: 'Unpaid Leave', category: 'UNPAID', defaultQuota: 0, isPaid: false, requiresAttachment: false, deductsAnnualLeave: false },
]

export interface HolidaySeed {
  code: string
  name: string
  /** Tanggal ISO yyyy-MM-dd */
  date: string
  kind: HolidayKind
}

export const HOLIDAYS: HolidaySeed[] = [
  { code: 'HOL_2026_PANCASILA', name: 'Hari Lahir Pancasila', date: '2026-06-01', kind: 'NATIONAL' },
  { code: 'HOL_2026_KEMERDEKAAN', name: 'Hari Kemerdekaan RI', date: '2026-08-17', kind: 'NATIONAL' },
  { code: 'HOL_2026_CB_NATAL', name: 'Cuti Bersama Natal', date: '2026-12-24', kind: 'COLLECTIVE_LEAVE' },
  { code: 'HOL_2026_NATAL', name: 'Hari Raya Natal', date: '2026-12-25', kind: 'NATIONAL' },
  { code: 'HOL_2026_CB_TAHUN_BARU', name: 'Cuti Bersama Tahun Baru', date: '2026-12-31', kind: 'COLLECTIVE_LEAVE' },
  { code: 'HOL_2027_TAHUN_BARU', name: 'Tahun Baru 2027', date: '2027-01-01', kind: 'NATIONAL' },
]

export interface TrainingCategorySeed {
  code: string
  name: string
  description?: string
}

export const TRAINING_CATEGORIES: TrainingCategorySeed[] = [
  { code: 'INTERNAL', name: 'Training Internal', description: 'Diselenggarakan oleh internal perusahaan' },
  { code: 'EXTERNAL', name: 'Training Eksternal', description: 'Workshop/seminar oleh pihak luar' },
  { code: 'CERTIFICATION', name: 'Sertifikasi', description: 'Program sertifikasi profesi' },
  { code: 'ONBOARDING', name: 'Onboarding', description: 'Orientasi karyawan baru' },
]

export interface KpiIndicatorSeed {
  name: string
  description?: string
  type: KpiIndicatorType
  weight: number
  target?: number
  unit?: string
}

export interface KpiTemplateSeed {
  code: string
  name: string
  description?: string
  period: KpiPeriod
  jobTitleCode?: string
  departmentCode?: string
  indicators: KpiIndicatorSeed[]
}

/** Contoh referensi bentuk data — total weight per template wajib 100. */
export const KPI_TEMPLATES: KpiTemplateSeed[] = [
  {
    code: 'STAFF_GENERAL',
    name: 'KPI Umum Staff',
    description: 'Template contoh untuk level Staff lintas departemen',
    period: 'QUARTERLY',
    jobTitleCode: 'STAFF',
    indicators: [
      { name: 'Kehadiran tepat waktu', type: 'QUANTITATIVE', weight: 30, target: 95, unit: '%' },
      { name: 'Penyelesaian tugas sesuai target', type: 'QUANTITATIVE', weight: 40, target: 100, unit: '%' },
      { name: 'Kerja sama & komunikasi tim', description: 'Penilaian perilaku oleh atasan langsung', type: 'QUALITATIVE', weight: 30 },
    ],
  },
]

/** Penugasan default akun Super Admin hasil seed. */
export const SUPER_ADMIN_ASSIGNMENT = {
  jobTitleCode: 'HR_SYSTEM_ADMIN',
  departmentCode: 'HRD',
  officeLocationCode: 'HO',
  workShiftCode: 'REGULAR',
} as const
