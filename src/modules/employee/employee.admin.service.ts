import type { HierarchyLevel, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { appConfig } from '../../lib/config.js'
import { wouldCreateCycle } from '../../lib/hierarchy.js'
import { getInvitationSender } from '../../lib/notifications/invitation-sender.js'
import { diffForAudit, recordAudit, type AuditContext } from '../../lib/audit.js'
import { issueAccountToken, revokeAccountTokens } from '../auth/account-token.service.js'
import { employeeService } from './employee.service.js'
import type {
  AccountInput,
  CreateEmployeeInput,
  EmployeeStatusInput,
  UpdateEmployeeInput,
} from './employee.schema.js'

type Tx = Prisma.TransactionClient

/** Role default akun baru berdasarkan level jabatan (keputusan bisnis 12 Nov 2026). */
export const DEFAULT_ROLE_BY_LEVEL: Record<HierarchyLevel, string> = {
  MANAGEMENT: 'MANAGEMENT',
  SR_MANAGER: 'SR_MANAGER',
  MANAGER: 'MANAGER',
  SUPERVISOR: 'SUPERVISOR',
  STAFF: 'STAFF',
}

/** Informasi undangan yang dikembalikan ke admin. Link hanya disertakan di luar production. */
export interface InvitationInfo {
  driver: string
  expiresAt: string
  devActivationLink?: string
}

interface PendingInvitation {
  email: string
  fullName: string
  token: string
  expiresAt: Date
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10)
}

function toDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

/** Kirim undangan setelah transaksi commit, agar email tidak terkirim untuk data yang di-rollback. */
async function deliverInvitation(invitation: PendingInvitation): Promise<InvitationInfo> {
  const sender = getInvitationSender()
  const link = `${appConfig.appBaseUrl}/activate?token=${invitation.token}`
  await sender.send({
    kind: 'ACTIVATION',
    to: invitation.email,
    fullName: invitation.fullName,
    link,
    expiresAt: invitation.expiresAt,
  })
  return {
    driver: sender.driver,
    expiresAt: invitation.expiresAt.toISOString(),
    ...(appConfig.exposeDevLinks ? { devActivationLink: link } : {}),
  }
}

/** Master data yang direferensikan harus ada dan aktif. */
async function assertMasterReferences(
  tx: Tx,
  refs: Pick<UpdateEmployeeInput, 'jobTitleId' | 'departmentId' | 'officeLocationId' | 'workShiftId'>,
) {
  const checks: Array<[string, string | null | undefined, (id: string) => Promise<{ isActive: boolean } | null>]> = [
    ['jobTitleId', refs.jobTitleId, (id) => tx.jobTitle.findUnique({ where: { id }, select: { isActive: true } })],
    ['departmentId', refs.departmentId, (id) => tx.department.findUnique({ where: { id }, select: { isActive: true } })],
    [
      'officeLocationId',
      refs.officeLocationId,
      (id) => tx.officeLocation.findUnique({ where: { id }, select: { isActive: true } }),
    ],
    ['workShiftId', refs.workShiftId, (id) => tx.workShift.findUnique({ where: { id }, select: { isActive: true } })],
  ]

  for (const [field, id, find] of checks) {
    if (!id) continue
    const record = await find(id)
    if (!record) throw new HttpError(422, `${field}: data master tidak ditemukan`)
    if (!record.isActive) throw new HttpError(422, `${field}: data master tidak aktif`)
  }
}

/** Atasan harus karyawan aktif dan tidak boleh membentuk siklus atasan. */
async function assertManager(tx: Tx, employeeId: string | undefined, managerId: string | null | undefined) {
  if (!managerId) return
  if (employeeId && managerId === employeeId) {
    throw new HttpError(422, 'managerId: karyawan tidak boleh menjadi atasan dirinya sendiri')
  }

  const manager = await tx.employee.findUnique({ where: { id: managerId }, select: { status: true } })
  if (!manager) throw new HttpError(422, 'managerId: atasan tidak ditemukan')
  if (manager.status !== 'ACTIVE') throw new HttpError(422, 'managerId: atasan sudah tidak aktif')

  if (employeeId) {
    const all = await tx.employee.findMany({ select: { id: true, managerId: true } })
    const parentOf = new Map(all.map((e) => [e.id, e.managerId]))
    if (wouldCreateCycle(parentOf, employeeId, managerId)) {
      throw new HttpError(422, 'managerId: membentuk siklus atasan (atasan berada di bawah karyawan ini)')
    }
  }
}

/** Buat akun PENDING_ACTIVATION untuk karyawan + token aktivasi (di dalam transaksi). */
async function createPendingAccount(
  tx: Tx,
  ctx: AuditContext,
  employee: { id: string; fullName: string; jobTitleId: string },
  input: AccountInput,
): Promise<PendingInvitation> {
  let roleCode = input.roleCode
  if (!roleCode) {
    const jobTitle = await tx.jobTitle.findUniqueOrThrow({ where: { id: employee.jobTitleId }, select: { level: true } })
    roleCode = DEFAULT_ROLE_BY_LEVEL[jobTitle.level] as AccountInput['roleCode']
  }
  const role = await tx.role.findUnique({ where: { code: roleCode! } })
  if (!role) throw new HttpError(422, `roleCode: role ${roleCode} tidak ditemukan`)

  const user = await tx.user.create({
    data: { email: input.email, passwordHash: null, status: 'PENDING_ACTIVATION', roleId: role.id },
  })
  await tx.employee.update({ where: { id: employee.id }, data: { userId: user.id } })
  const { token, expiresAt } = await issueAccountToken(tx, user.id, 'ACTIVATION')
  await recordAudit(tx, ctx, {
    action: 'employee.account.create',
    entityType: 'employee',
    entityId: employee.id,
    changes: { userId: user.id, email: user.email, roleCode: role.code, status: 'PENDING_ACTIVATION' },
  })
  return { email: user.email, fullName: employee.fullName, token, expiresAt }
}

async function findEmployeeOrThrow(tx: Tx, id: string) {
  const employee = await tx.employee.findUnique({ where: { id }, include: { user: true } })
  if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')
  return employee
}

export const employeeAdminService = {
  /** US-2.2: buat data karyawan, opsional sekaligus akun + undangan. */
  async create(input: CreateEmployeeInput, ctx: AuditContext) {
    const { account, joinDate, ...fields } = input

    const { employeeId, invitation } = await prisma.$transaction(async (tx) => {
      await assertMasterReferences(tx, fields)
      await assertManager(tx, undefined, fields.managerId)

      const employee = await tx.employee.create({
        data: { ...fields, joinDate: toDate(joinDate ?? todayDateOnly()) },
      })
      await recordAudit(tx, ctx, {
        action: 'employee.create',
        entityType: 'employee',
        entityId: employee.id,
        changes: { after: employee },
      })
      const pending = account ? await createPendingAccount(tx, ctx, employee, account) : undefined
      return { employeeId: employee.id, invitation: pending }
    })

    return {
      employee: await employeeService.getById(employeeId),
      invitation: invitation ? await deliverInvitation(invitation) : undefined,
    }
  },

  async update(id: string, input: UpdateEmployeeInput, ctx: AuditContext) {
    const { joinDate, ...fields } = input
    await prisma.$transaction(async (tx) => {
      const { user: _user, ...before } = await findEmployeeOrThrow(tx, id)
      await assertMasterReferences(tx, fields)
      await assertManager(tx, id, fields.managerId)
      const after = await tx.employee.update({
        where: { id },
        data: { ...fields, ...(joinDate ? { joinDate: toDate(joinDate) } : {}) },
      })
      await recordAudit(tx, ctx, {
        action: 'employee.update',
        entityType: 'employee',
        entityId: id,
        changes: diffForAudit(before, after),
      })
    })
    return employeeService.getById(id)
  },

  /** Buat akun login untuk karyawan yang belum punya akun, lalu kirim undangan. */
  async createAccount(id: string, input: AccountInput, ctx: AuditContext) {
    const invitation = await prisma.$transaction(async (tx) => {
      const employee = await findEmployeeOrThrow(tx, id)
      if (employee.status !== 'ACTIVE') throw new HttpError(422, 'Karyawan tidak aktif — aktifkan kembali terlebih dahulu')
      if (employee.userId) throw new HttpError(409, 'Karyawan sudah memiliki akun')
      return createPendingAccount(tx, ctx, employee, input)
    })
    return { employee: await employeeService.getById(id), invitation: await deliverInvitation(invitation) }
  },

  /** Kirim ulang undangan; link sebelumnya otomatis hangus. */
  async resendInvitation(id: string, ctx: AuditContext) {
    const invitation = await prisma.$transaction(async (tx) => {
      const employee = await findEmployeeOrThrow(tx, id)
      if (!employee.user) throw new HttpError(409, 'Karyawan belum memiliki akun')
      if (employee.status !== 'ACTIVE') throw new HttpError(422, 'Karyawan tidak aktif')
      if (employee.user.status !== 'PENDING_ACTIVATION') {
        throw new HttpError(409, 'Akun tidak menunggu aktivasi (sudah aktif atau dinonaktifkan)')
      }
      const { token, expiresAt } = await issueAccountToken(tx, employee.user.id, 'ACTIVATION')
      await recordAudit(tx, ctx, {
        action: 'employee.account.invitation_resend',
        entityType: 'employee',
        entityId: id,
        changes: { email: employee.user.email },
      })
      return { email: employee.user.email, fullName: employee.fullName, token, expiresAt }
    })
    return { invitation: await deliverInvitation(invitation) }
  },

  /**
   * Nonaktifkan (karyawan keluar) atau aktifkan kembali. Data tidak pernah dihapus.
   * - INACTIVE: akun → DISABLED, refresh token dicabut, token aktivasi/reset dihapus.
   * - ACTIVE: akun (bila ada) → PENDING_ACTIVATION tanpa password + undangan baru.
   */
  async setStatus(id: string, input: EmployeeStatusInput, actorEmployeeId: string | undefined, ctx: AuditContext) {
    const invitation = await prisma.$transaction(async (tx) => {
      const employee = await findEmployeeOrThrow(tx, id)
      if (employee.status === input.status) {
        throw new HttpError(409, `Karyawan sudah berstatus ${input.status}`)
      }

      if (input.status === 'INACTIVE') {
        if (actorEmployeeId === id) throw new HttpError(422, 'Tidak dapat menonaktifkan akun Anda sendiri')
        const exitDate = toDate(input.exitDate ?? todayDateOnly())
        if (exitDate < toDate(employee.joinDate.toISOString().slice(0, 10))) {
          throw new HttpError(400, 'exitDate tidak boleh sebelum joinDate')
        }

        await tx.employee.update({ where: { id }, data: { status: 'INACTIVE', exitDate } })
        await recordAudit(tx, ctx, {
          action: 'employee.deactivate',
          entityType: 'employee',
          entityId: id,
          changes: {
            status: { from: 'ACTIVE', to: 'INACTIVE' },
            exitDate,
            account: employee.user ? { from: employee.user.status, to: 'DISABLED' } : null,
          },
        })
        if (employee.user) {
          await tx.user.update({
            where: { id: employee.user.id },
            data: { status: 'DISABLED', sessionVersion: { increment: 1 } },
          })
          await tx.refreshToken.updateMany({ where: { userId: employee.user.id, revoked: false }, data: { revoked: true } })
          await revokeAccountTokens(tx, employee.user.id)
        }
        return undefined
      }

      await tx.employee.update({ where: { id }, data: { status: 'ACTIVE', exitDate: null } })
      await recordAudit(tx, ctx, {
        action: 'employee.reactivate',
        entityType: 'employee',
        entityId: id,
        changes: {
          status: { from: 'INACTIVE', to: 'ACTIVE' },
          exitDate: { from: employee.exitDate, to: null },
          account: employee.user ? { from: employee.user.status, to: 'PENDING_ACTIVATION' } : null,
        },
      })
      if (!employee.user) return undefined

      await tx.user.update({
        where: { id: employee.user.id },
        data: { status: 'PENDING_ACTIVATION', passwordHash: null, sessionVersion: { increment: 1 } },
      })
      const { token, expiresAt } = await issueAccountToken(tx, employee.user.id, 'ACTIVATION')
      return { email: employee.user.email, fullName: employee.fullName, token, expiresAt }
    })

    return {
      employee: await employeeService.getById(id),
      invitation: invitation ? await deliverInvitation(invitation) : undefined,
    }
  },
}
