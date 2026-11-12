import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { lateEmployeesOn } from '../attendance/attendance.service.js'
import { employeeService } from '../employee/employee.service.js'

const personSelect = {
  id: true,
  fullName: true,
  jobTitle: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
} as const

/**
 * Dashboard 5-in-1 (PRD Module 3, US-4.1). Hanya data minimum (nama, jabatan, departemen) —
 * tanpa alasan cuti/sakit — karena widget ini terlihat oleh semua karyawan.
 */
export async function dashboardFor(date: string, upcomingTrainingDays: number, viewerEmployeeId: string | null) {
  const day = fromDateOnly(date)
  const coversDate = { startDate: { lte: day }, endDate: { gte: day } }
  const activeEmployee = { status: 'ACTIVE' as const }

  const [late, onLeave, sick, birthdays, trainings] = await Promise.all([
    lateEmployeesOn(date),
    // Cuti: hanya yang sudah DISETUJUI (PRD: "cuti resmi yang telah disetujui")
    prisma.leaveRequest.findMany({
      where: { ...coversDate, status: 'APPROVED', leaveType: { category: { not: 'SICK' } }, employee: activeEmployee },
      select: {
        startDate: true,
        endDate: true,
        leaveType: { select: { code: true, name: true } },
        employee: { select: personSelect },
      },
      orderBy: { employee: { fullName: 'asc' } },
    }),
    // Sakit: yang MENGAJUKAN izin sakit (PENDING maupun APPROVED) — PRD: "mengajukan izin tidak hadir karena sakit"
    prisma.leaveRequest.findMany({
      where: {
        ...coversDate,
        status: { in: ['PENDING', 'APPROVED'] },
        leaveType: { category: 'SICK' },
        employee: activeEmployee,
      },
      select: { status: true, employee: { select: personSelect } },
      orderBy: { employee: { fullName: 'asc' } },
    }),
    employeeService.birthdays({ from: date, to: date }),
    prisma.training.findMany({
      where: {
        status: 'SCHEDULED',
        endAt: { gte: day },
        startAt: { lt: addDays(day, upcomingTrainingDays + 1) },
      },
      select: {
        id: true,
        title: true,
        location: true,
        startAt: true,
        endAt: true,
        category: { select: { id: true, code: true, name: true } },
        participants: { select: { employeeId: true } },
      },
      orderBy: { startAt: 'asc' },
    }),
  ])

  const result = {
    date,
    late: late.map((l) => ({
      employee: { id: l.employee.id, fullName: l.employee.fullName, jobTitle: l.employee.jobTitle, department: l.employee.department },
      lateMinutes: l.lateMinutes,
      clockIn: l.clockIn,
    })),
    onLeave: onLeave.map((l) => ({
      employee: l.employee,
      leaveType: l.leaveType,
      startDate: toDateOnly(l.startDate),
      endDate: toDateOnly(l.endDate),
    })),
    sick: sick.map((s) => ({ employee: s.employee, status: s.status })),
    birthdays: birthdays.data.map((b) => ({
      employee: { id: b.id, fullName: b.fullName, jobTitle: b.jobTitle, department: b.department },
    })),
    trainings: trainings.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      location: t.location,
      startAt: t.startAt.toISOString(),
      endAt: t.endAt.toISOString(),
      participantCount: t.participants.length,
      isParticipant: viewerEmployeeId ? t.participants.some((p) => p.employeeId === viewerEmployeeId) : false,
    })),
  }

  return {
    ...result,
    counts: {
      late: result.late.length,
      onLeave: result.onLeave.length,
      sick: result.sick.length,
      birthdays: result.birthdays.length,
      trainings: result.trainings.length,
    },
  }
}
