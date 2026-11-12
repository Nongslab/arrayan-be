/**
 * Rencana data demo (dev only) — fungsi murni & deterministik: input sama → output sama.
 * Semua tanggal relatif terhadap `today` agar dashboard/kalender selalu "hidup" kapan pun seed dijalankan.
 *
 * Penanda data demo (dipakai untuk membersihkan ulang):
 *   - NIK karyawan berawalan `DEMO-`
 *   - email akun berakhiran `@demo.arrayan.test`
 *   - deskripsi training & event kalender berakhiran `DEMO_MARKER`
 */
import type { AttendanceSource, EmployeeStatus, EmploymentType, Gender, LeaveRequestStatus, TrainingStatus } from '@prisma/client'
import { addDays, addMonths, fromDateOnly, toDateOnly } from '../../src/lib/dates.js'
import { isoWeekday } from '../../src/modules/leave/leave.rules.js'
import { PROBATION_MONTHS } from '../../src/modules/employee/employee.probation.js'

export const DEMO_NIK_PREFIX = 'DEMO-'
export const DEMO_EMAIL_DOMAIN = 'demo.arrayan.test'
export const DEMO_MARKER = '(data demo)'
export const DEMO_PASSWORD = 'DemoArrayan123!'
export const WORK_DAYS = [1, 2, 3, 4, 5] as const

export type DemoRole = 'SUPER_ADMIN' | 'MANAGEMENT' | 'SR_MANAGER' | 'MANAGER' | 'SUPERVISOR' | 'STAFF'
export type DemoAccount = 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE'

export interface DemoEmployee {
  key: string
  nik: string
  fullName: string
  gender: Gender
  jobTitleCode: string
  departmentCode: string
  managerKey: string | null
  role: DemoRole
  account: DemoAccount
  email: string | null
  employmentType: EmploymentType
  joinDate: string
  probationEndDate: string | null
  status: EmployeeStatus
  exitDate: string | null
  birthDate: string
  phone: string
  /** Lebih sering terlambat (agar widget "terlambat" berisi) */
  lateProne: boolean
}

export interface DemoLeave {
  employeeKey: string
  leaveTypeCode: 'ANNUAL' | 'SICK' | 'PERMISSION'
  startDate: string
  endDate: string
  status: LeaveRequestStatus
  reason: string
  cancelReason?: string
}

export interface DemoAttendanceLog {
  employeeKey: string
  occurredAt: Date
  source: AttendanceSource
  kind: 'IN' | 'OUT'
  /** Offset GPS (derajat) dari titik kantor — hanya untuk APP */
  gpsOffset: { lat: number; lng: number } | null
  deviceCode: string | null
}

export interface DemoTraining {
  title: string
  categoryCode: 'INTERNAL' | 'EXTERNAL' | 'CERTIFICATION' | 'ONBOARDING'
  description: string
  organizer: string
  location: string
  date: string
  startTime: string
  endTime: string
  status: TrainingStatus
  participants: { employeeKey: string; attended: boolean | null; rating: number | null; remarks: string | null }[]
}

export interface DemoEvent {
  title: string
  description: string
  location: string | null
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
}

export interface DemoPlan {
  employees: DemoEmployee[]
  leaves: DemoLeave[]
  adjustments: { employeeKey: string; leaveTypeCode: 'ANNUAL'; year: number; days: number; reason: string }[]
  attendance: DemoAttendanceLog[]
  trainings: DemoTraining[]
  events: DemoEvent[]
}

export interface PlanInput {
  /** Hari ini (yyyy-MM-dd, Asia/Jakarta) */
  today: string
  /** Waktu sekarang — log absensi hari ini tidak dibuat di masa depan */
  now: Date
  /** Hari libur aktif (yyyy-MM-dd) */
  holidays: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

/** PRNG deterministik (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)
  return h >>> 0
}

const shift = (date: string, days: number) => toDateOnly(addDays(fromDateOnly(date), days))

export function isWorkingDay(date: string, holidays: ReadonlySet<string>): boolean {
  return (WORK_DAYS as readonly number[]).includes(isoWeekday(date)) && !holidays.has(date)
}

/** Hari kerja ke-n dari `date` (n = 0 → `date` sendiri bila hari kerja, selain itu hari kerja berikutnya). */
export function workingDayFrom(date: string, n: number, holidays: ReadonlySet<string>): string {
  const step = n < 0 ? -1 : 1
  let d = date
  while (!isWorkingDay(d, holidays)) d = shift(d, step)
  for (let left = Math.abs(n); left > 0; ) {
    d = shift(d, step)
    if (isWorkingDay(d, holidays)) left--
  }
  return d
}

/** Waktu lokal Jakarta (UTC+7, tanpa DST) → instant. */
export function jakarta(date: string, minutesOfDay: number): Date {
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, '0')
  const mm = String(minutesOfDay % 60).padStart(2, '0')
  return new Date(`${date}T${hh}:${mm}:00+07:00`)
}

/** "HH:mm" → menit sejak tengah malam. */
export const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Tanggal lahir dengan bulan-hari tertentu relatif terhadap `today` (aman untuk 29 Feb). */
function birthday(today: string, year: number, offsetDays: number): string {
  const md = shift(today, offsetDays).slice(5)
  return `${year}-${md === '02-29' ? '02-28' : md}`
}

// ---------------------------------------------------------------------------
// Organisasi
// ---------------------------------------------------------------------------

type EmployeeSeed = Omit<DemoEmployee, 'nik' | 'email' | 'probationEndDate' | 'joinDate' | 'birthDate' | 'phone' | 'exitDate' | 'status' | 'lateProne'> & {
  joinDaysAgo: number
  birth: { year: number; offsetDays: number }
  status?: EmployeeStatus
  exitDaysAgo?: number
  lateProne?: boolean
}

const ORG: EmployeeSeed[] = [
  { key: 'DIR', fullName: 'Hendra Wijaya', gender: 'MALE', jobTitleCode: 'DIRECTOR', departmentCode: 'HQ', managerKey: null, role: 'MANAGEMENT', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 3650, birth: { year: 1972, offsetDays: 140 } },
  { key: 'HR_MGR', fullName: 'Siti Rahmawati', gender: 'FEMALE', jobTitleCode: 'MANAGER', departmentCode: 'HRD', managerKey: 'DIR', role: 'SUPER_ADMIN', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 2400, birth: { year: 1985, offsetDays: 60 } },
  { key: 'HR_S1', fullName: 'Andi Firmansyah', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'HRD', managerKey: 'HR_MGR', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 900, birth: { year: 1996, offsetDays: 200 } },
  { key: 'ENG_SM', fullName: 'Rina Kusuma', gender: 'FEMALE', jobTitleCode: 'SR_MANAGER', departmentCode: 'ENG', managerKey: 'DIR', role: 'SR_MANAGER', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 2900, birth: { year: 1982, offsetDays: 95 } },
  { key: 'ENG_MGR', fullName: 'Agus Prasetyo', gender: 'MALE', jobTitleCode: 'MANAGER', departmentCode: 'ENG', managerKey: 'ENG_SM', role: 'MANAGER', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 2100, birth: { year: 1987, offsetDays: 250 } },
  { key: 'ENG_SPV', fullName: 'Dewi Lestari', gender: 'FEMALE', jobTitleCode: 'SUPERVISOR', departmentCode: 'ENG', managerKey: 'ENG_MGR', role: 'SUPERVISOR', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1500, birth: { year: 1990, offsetDays: 12 } },
  { key: 'ENG_S1', fullName: 'Fajar Nugroho', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'ENG', managerKey: 'ENG_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1100, birth: { year: 1995, offsetDays: 0 }, lateProne: true },
  { key: 'ENG_S2', fullName: 'Sari Wulandari', gender: 'FEMALE', jobTitleCode: 'STAFF', departmentCode: 'ENG', managerKey: 'ENG_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 800, birth: { year: 1997, offsetDays: 175 } },
  { key: 'ENG_S3', fullName: 'Yoga Pratama', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'ENG', managerKey: 'ENG_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'PROBATION', joinDaysAgo: 160, birth: { year: 1999, offsetDays: 320 } },
  { key: 'ENG_S4', fullName: 'Intan Permata', gender: 'FEMALE', jobTitleCode: 'STAFF', departmentCode: 'ENG', managerKey: 'ENG_MGR', role: 'STAFF', account: 'PENDING_ACTIVATION', employmentType: 'PROBATION', joinDaysAgo: 14, birth: { year: 2000, offsetDays: 45 } },
  { key: 'ENG_PKL', fullName: 'Rizky Ramadhan', gender: 'MALE', jobTitleCode: 'INTERN', departmentCode: 'ENG', managerKey: 'ENG_SPV', role: 'STAFF', account: 'NONE', employmentType: 'PKL', joinDaysAgo: 75, birth: { year: 2004, offsetDays: 290 } },
  { key: 'FIN_MGR', fullName: 'Lina Marlina', gender: 'FEMALE', jobTitleCode: 'MANAGER', departmentCode: 'FIN', managerKey: 'DIR', role: 'MANAGER', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 2600, birth: { year: 1984, offsetDays: 30 } },
  { key: 'FIN_S1', fullName: 'Bambang Sutrisno', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'FIN', managerKey: 'FIN_MGR', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1300, birth: { year: 1991, offsetDays: 110 } },
  { key: 'FIN_S2', fullName: 'Maya Anggraini', gender: 'FEMALE', jobTitleCode: 'STAFF', departmentCode: 'FIN', managerKey: 'FIN_MGR', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 700, birth: { year: 1998, offsetDays: 3 } },
  { key: 'OPS_MGR', fullName: 'Teguh Santoso', gender: 'MALE', jobTitleCode: 'MANAGER', departmentCode: 'OPS', managerKey: 'DIR', role: 'MANAGER', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 2200, birth: { year: 1983, offsetDays: 215 } },
  { key: 'OPS_SPV', fullName: 'Nur Aisyah', gender: 'FEMALE', jobTitleCode: 'SUPERVISOR', departmentCode: 'OPS', managerKey: 'OPS_MGR', role: 'SUPERVISOR', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1600, birth: { year: 1989, offsetDays: 6 } },
  { key: 'OPS_S1', fullName: 'Dimas Saputra', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'OPS', managerKey: 'OPS_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1000, birth: { year: 1994, offsetDays: 150 } },
  { key: 'OPS_S2', fullName: 'Putri Handayani', gender: 'FEMALE', jobTitleCode: 'STAFF', departmentCode: 'OPS', managerKey: 'OPS_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 600, birth: { year: 1996, offsetDays: 340 } },
  { key: 'OPS_S3', fullName: 'Eko Wahyudi', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'OPS', managerKey: 'OPS_SPV', role: 'STAFF', account: 'ACTIVE', employmentType: 'KARTAP', joinDaysAgo: 1200, birth: { year: 1993, offsetDays: 80 }, lateProne: true },
  { key: 'OPS_EX', fullName: 'Rudi Hartono', gender: 'MALE', jobTitleCode: 'STAFF', departmentCode: 'OPS', managerKey: 'OPS_SPV', role: 'STAFF', account: 'DISABLED', employmentType: 'KARTAP', joinDaysAgo: 1400, birth: { year: 1992, offsetDays: 230 }, status: 'INACTIVE', exitDaysAgo: 60 },
]

function emailFor(fullName: string): string {
  const [first, ...rest] = fullName.toLowerCase().split(' ')
  return `${first}.${rest.join('')}@${DEMO_EMAIL_DOMAIN}`
}

function buildEmployees(today: string): DemoEmployee[] {
  return ORG.map((e, index) => {
    const { joinDaysAgo, birth, exitDaysAgo, ...rest } = e
    const joinDate = shift(today, -joinDaysAgo)
    return {
      ...rest,
      nik: `${DEMO_NIK_PREFIX}${String(index + 1).padStart(3, '0')}`,
      email: e.account === 'NONE' ? null : emailFor(e.fullName),
      joinDate,
      // PRD: probation 6 bulan sejak bergabung
      probationEndDate: e.employmentType === 'PROBATION' ? toDateOnly(addMonths(fromDateOnly(joinDate), PROBATION_MONTHS)) : null,
      status: e.status ?? 'ACTIVE',
      exitDate: exitDaysAgo !== undefined ? shift(today, -exitDaysAgo) : null,
      birthDate: birthday(today, birth.year, birth.offsetDays),
      phone: `08${String(1200000000 + hashString(e.key) % 800000000).padStart(10, '0')}`,
      lateProne: e.lateProne ?? false,
    }
  })
}

// ---------------------------------------------------------------------------
// Cuti
// ---------------------------------------------------------------------------

function buildLeaves(today: string, holidays: ReadonlySet<string>): DemoLeave[] {
  const wd = (n: number) => workingDayFrom(today, n, holidays)
  return [
    // Widget dashboard hari ini (hari kerja terdekat bila seed dijalankan di akhir pekan)
    { employeeKey: 'ENG_S2', leaveTypeCode: 'ANNUAL', startDate: wd(0), endDate: wd(1), status: 'APPROVED', reason: 'Acara keluarga di luar kota' },
    { employeeKey: 'OPS_S2', leaveTypeCode: 'SICK', startDate: wd(0), endDate: wd(0), status: 'APPROVED', reason: 'Demam, surat dokter menyusul' },
    { employeeKey: 'HR_S1', leaveTypeCode: 'SICK', startDate: wd(0), endDate: wd(0), status: 'PENDING', reason: 'Sakit kepala / migrain' },
    // Riwayat
    { employeeKey: 'FIN_S1', leaveTypeCode: 'ANNUAL', startDate: wd(-9), endDate: wd(-8), status: 'APPROVED', reason: 'Liburan' },
    { employeeKey: 'ENG_SPV', leaveTypeCode: 'PERMISSION', startDate: wd(-6), endDate: wd(-6), status: 'APPROVED', reason: 'Mengurus dokumen kependudukan' },
    { employeeKey: 'OPS_MGR', leaveTypeCode: 'ANNUAL', startDate: wd(-15), endDate: wd(-13), status: 'APPROVED', reason: 'Pulang kampung' },
    { employeeKey: 'FIN_S2', leaveTypeCode: 'SICK', startDate: wd(-4), endDate: wd(-4), status: 'APPROVED', reason: 'Flu' },
    // Mendatang
    { employeeKey: 'OPS_S1', leaveTypeCode: 'ANNUAL', startDate: wd(7), endDate: wd(9), status: 'PENDING', reason: 'Pernikahan saudara' },
    { employeeKey: 'ENG_MGR', leaveTypeCode: 'ANNUAL', startDate: wd(12), endDate: wd(12), status: 'APPROVED', reason: 'Keperluan pribadi' },
    {
      employeeKey: 'ENG_S1',
      leaveTypeCode: 'ANNUAL',
      startDate: wd(4),
      endDate: wd(5),
      status: 'CANCELLED',
      reason: 'Liburan',
      cancelReason: 'Jadwal rilis maju',
    },
  ]
}

// ---------------------------------------------------------------------------
// Absensi — 30 hari terakhir s.d. hari ini (hanya log yang waktunya ≤ now)
// ---------------------------------------------------------------------------

const ATTENDANCE_DAYS = 30
const SHIFT_START = hm('08:00')

function buildAttendance(input: PlanInput, employees: DemoEmployee[], leaves: DemoLeave[]): DemoAttendanceLog[] {
  const { today, now, holidays } = input
  const onLeave = new Set<string>()
  for (const l of leaves) {
    if (l.status === 'CANCELLED') continue
    for (let d = l.startDate; d <= l.endDate; d = shift(d, 1)) onLeave.add(`${l.employeeKey}:${d}`)
  }

  const logs: DemoAttendanceLog[] = []
  for (const e of employees) {
    for (let offset = -ATTENDANCE_DAYS; offset <= 0; offset++) {
      const date = shift(today, offset)
      if (!isWorkingDay(date, holidays) || date < e.joinDate) continue
      if (e.exitDate && date > e.exitDate) continue
      if (onLeave.has(`${e.key}:${date}`)) continue
      const r = rng(hashString(`${e.key}:${date}`))
      const isToday = offset === 0
      if (!isToday && r() < 0.03) continue // mangkir

      let inMinutes: number
      if (isToday && e.key === 'OPS_S3') inMinutes = SHIFT_START + 37
      else if (isToday && e.key === 'ENG_S1') inMinutes = SHIFT_START + 22
      else if (r() < (e.lateProne ? 0.25 : 0.05)) inMinutes = SHIFT_START + 16 + Math.floor(r() * 60)
      else inMinutes = SHIFT_START - 20 + Math.floor(r() * 32) // 07:40–08:11
      const outMinutes = hm('17:00') + Math.floor(r() * 70)
      const missingOut = r() < 0.03

      // Karyawan tanpa akun aplikasi hanya lewat fingerprint
      const viaApp = e.account === 'ACTIVE' && r() < 0.7
      const source: AttendanceSource = viaApp ? 'APP' : 'FINGERPRINT'
      const gps = () => (viaApp ? { lat: (r() - 0.5) * 0.0008, lng: (r() - 0.5) * 0.0008 } : null)
      const base = { employeeKey: e.key, source, deviceCode: viaApp ? null : 'FP-HO-01' }

      const clockIn = jakarta(date, inMinutes)
      if (clockIn <= now) logs.push({ ...base, kind: 'IN', occurredAt: clockIn, gpsOffset: gps() })
      const clockOut = jakarta(date, outMinutes)
      if (!missingOut && clockOut <= now) logs.push({ ...base, kind: 'OUT', occurredAt: clockOut, gpsOffset: gps() })
    }
  }
  return logs
}

// ---------------------------------------------------------------------------
// Training & event kantor
// ---------------------------------------------------------------------------

function buildTrainings(today: string, holidays: ReadonlySet<string>): DemoTraining[] {
  const wd = (n: number) => workingDayFrom(today, n, holidays)
  const desc = (text: string) => `${text} ${DEMO_MARKER}`
  const attended = (keys: string[], absent: string[] = []) =>
    keys.map((employeeKey) => ({ employeeKey, attended: !absent.includes(employeeKey), rating: null, remarks: null }))
  const pending = (keys: string[]) => keys.map((employeeKey) => ({ employeeKey, attended: null, rating: null, remarks: null }))

  return [
    {
      title: 'Onboarding Karyawan Baru',
      categoryCode: 'ONBOARDING',
      description: desc('Pengenalan budaya perusahaan, kebijakan HR, dan sistem kerja.'),
      organizer: 'People & Culture',
      location: 'Ruang Meeting Lt. 3',
      date: wd(-12),
      startTime: '09:00',
      endTime: '12:00',
      status: 'SCHEDULED',
      participants: [
        { employeeKey: 'ENG_S3', attended: true, rating: 5, remarks: 'Materi jelas, sangat membantu memahami alur kerja.' },
        { employeeKey: 'ENG_PKL', attended: true, rating: null, remarks: null },
      ],
    },
    {
      title: 'Workshop Keamanan Informasi',
      categoryCode: 'INTERNAL',
      description: desc('Phishing, password manager, dan klasifikasi data.'),
      organizer: 'Tim IT',
      location: 'Aula Kantor Pusat',
      date: wd(-6),
      startTime: '13:00',
      endTime: '16:00',
      status: 'SCHEDULED',
      participants: [
        { employeeKey: 'ENG_S1', attended: true, rating: 4, remarks: 'Studi kasus phishing paling berguna.' },
        { employeeKey: 'ENG_S2', attended: true, rating: 5, remarks: 'Perlu sesi lanjutan untuk developer.' },
        ...attended(['ENG_SPV', 'FIN_S1', 'FIN_S2', 'OPS_S1'], ['OPS_S1']),
      ],
    },
    {
      title: 'Seminar Perpajakan 2026',
      categoryCode: 'EXTERNAL',
      description: desc('Pembaruan regulasi PPh 21. Dibatalkan oleh penyelenggara.'),
      organizer: 'Konsultan Pajak Mitra',
      location: 'Hotel Grand, Jakarta',
      date: wd(3),
      startTime: '09:00',
      endTime: '15:00',
      status: 'CANCELLED',
      participants: pending(['FIN_MGR', 'FIN_S1']),
    },
    {
      title: 'Sertifikasi Scrum Master',
      categoryCode: 'CERTIFICATION',
      description: desc('Persiapan ujian PSM I.'),
      organizer: 'Agile Academy',
      location: 'Online (Zoom)',
      date: wd(2),
      startTime: '09:00',
      endTime: '17:00',
      status: 'SCHEDULED',
      participants: pending(['ENG_MGR', 'ENG_SPV']),
    },
    {
      title: 'Leadership untuk Supervisor',
      categoryCode: 'INTERNAL',
      description: desc('Coaching, delegasi, dan memberi feedback.'),
      organizer: 'People & Culture',
      location: 'Ruang Meeting Lt. 3',
      date: wd(4),
      startTime: '09:00',
      endTime: '15:00',
      status: 'SCHEDULED',
      participants: pending(['ENG_SPV', 'OPS_SPV', 'FIN_MGR']),
    },
    {
      title: 'Excel Lanjutan untuk Finance',
      categoryCode: 'EXTERNAL',
      description: desc('Pivot table, Power Query, dan dashboard sederhana.'),
      organizer: 'Data Skill Center',
      location: 'Kantor Pusat',
      date: wd(15),
      startTime: '09:00',
      endTime: '16:00',
      status: 'SCHEDULED',
      participants: pending(['FIN_S1', 'FIN_S2']),
    },
  ]
}

function buildEvents(today: string, holidays: ReadonlySet<string>): DemoEvent[] {
  const wd = (n: number) => workingDayFrom(today, n, holidays)
  const gathering = shift(today, 24)
  return [
    {
      title: 'Townhall Kuartal',
      description: `Update kinerja perusahaan & sesi tanya jawab bersama Direksi. ${DEMO_MARKER}`,
      location: 'Aula Kantor Pusat',
      startDate: wd(5),
      endDate: wd(5),
      startTime: '15:00',
      endTime: '16:30',
    },
    {
      title: 'Family Gathering',
      description: `Outing tahunan karyawan beserta keluarga. ${DEMO_MARKER}`,
      location: 'Puncak, Bogor',
      startDate: gathering,
      endDate: shift(gathering, 1),
      startTime: null,
      endTime: null,
    },
  ]
}

export function buildDemoPlan(input: PlanInput): DemoPlan {
  const employees = buildEmployees(input.today)
  const leaves = buildLeaves(input.today, input.holidays)
  return {
    employees,
    leaves,
    adjustments: [
      { employeeKey: 'ENG_SM', leaveTypeCode: 'ANNUAL', year: Number(input.today.slice(0, 4)), days: 2, reason: 'Carry-over sisa cuti tahun lalu' },
    ],
    attendance: buildAttendance(input, employees, leaves),
    trainings: buildTrainings(input.today, input.holidays),
    events: buildEvents(input.today, input.holidays),
  }
}
