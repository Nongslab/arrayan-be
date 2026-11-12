import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { buildEmployeeTree, HIERARCHY_RANK, type TreeNode } from './employee.tree.js'
import type { EmployeeListQuery } from './employee.schema.js'

const jobTitleSelect = { select: { id: true, code: true, name: true, level: true } } as const
const refSelect = { select: { id: true, code: true, name: true } } as const

const employeeInclude = {
  jobTitle: jobTitleSelect,
  department: refSelect,
  officeLocation: refSelect,
  workShift: refSelect,
  manager: { select: { id: true, nik: true, fullName: true, jobTitle: jobTitleSelect } },
  user: { select: { email: true, isActive: true, role: { select: { code: true, name: true } } } },
  _count: { select: { subordinates: true } },
} satisfies Prisma.EmployeeInclude

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>

/** Status akun login karyawan. Akan diperluas dengan PENDING_ACTIVATION saat provisioning (US-2.2). */
export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'NO_ACCOUNT'

function accountStatusOf(user: EmployeeRow['user']): AccountStatus {
  if (!user) return 'NO_ACCOUNT'
  return user.isActive ? 'ACTIVE' : 'INACTIVE'
}

/** Bentuk publik karyawan. Tidak pernah memuat passwordHash / token (AGENTS.md §3). */
export function serializeEmployee(row: EmployeeRow) {
  return {
    id: row.id,
    nik: row.nik,
    fullName: row.fullName,
    employmentType: row.employmentType,
    joinDate: row.joinDate.toISOString(),
    jobTitle: row.jobTitle,
    department: row.department,
    officeLocation: row.officeLocation,
    workShift: row.workShift,
    managerId: row.managerId,
    manager: row.manager,
    account: row.user
      ? { email: row.user.email, role: row.user.role, status: accountStatusOf(row.user) }
      : null,
    accountStatus: accountStatusOf(row.user),
    subordinateCount: row._count.subordinates,
  }
}

/** Seluruh id turunan sebuah departemen (termasuk dirinya). Data master kecil → cukup dimuat sekali. */
async function departmentWithDescendants(departmentId: string): Promise<string[]> {
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const d of all) {
    if (!d.parentId) continue
    childrenOf.set(d.parentId, [...(childrenOf.get(d.parentId) ?? []), d.id])
  }
  const result = new Set<string>()
  const stack = [departmentId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return [...result]
}

function accountStatusWhere(status: AccountStatus): Prisma.EmployeeWhereInput {
  switch (status) {
    case 'NO_ACCOUNT':
      return { userId: null }
    case 'ACTIVE':
      return { user: { isActive: true } }
    case 'INACTIVE':
      return { user: { isActive: false } }
  }
}

export const employeeService = {
  async list(query: EmployeeListQuery) {
    const where: Prisma.EmployeeWhereInput = {}
    const and: Prisma.EmployeeWhereInput[] = []

    if (query.departmentId) {
      where.departmentId = query.includeSubDepartments
        ? { in: await departmentWithDescendants(query.departmentId) }
        : query.departmentId
    }
    if (query.jobTitleId) where.jobTitleId = query.jobTitleId
    if (query.managerId) where.managerId = query.managerId
    if (query.employmentType) where.employmentType = query.employmentType
    if (query.accountStatus) and.push(accountStatusWhere(query.accountStatus))
    if (query.q) {
      and.push({
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { nik: { contains: query.q, mode: 'insensitive' } },
        ],
      })
    }
    if (and.length > 0) where.AND = and

    const [rows, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: [{ fullName: 'asc' }, { nik: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.employee.count({ where }),
    ])

    return { data: rows.map(serializeEmployee), meta: { page: query.page, limit: query.limit, total } }
  },

  async getById(id: string) {
    const row = await prisma.employee.findUnique({
      where: { id },
      include: {
        ...employeeInclude,
        subordinates: {
          select: { id: true, nik: true, fullName: true, jobTitle: jobTitleSelect },
          orderBy: { fullName: 'asc' },
        },
      },
    })
    if (!row) throw new HttpError(404, 'Karyawan tidak ditemukan')

    return {
      ...serializeEmployee(row),
      subordinates: row.subordinates,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  },

  /** Pohon organisasi seluruh karyawan, atau subtree mulai dari `rootId`. */
  async tree(rootId?: string) {
    const rows = await prisma.employee.findMany({
      select: {
        id: true,
        nik: true,
        fullName: true,
        employmentType: true,
        managerId: true,
        jobTitle: jobTitleSelect,
        department: refSelect,
      },
    })

    type Row = (typeof rows)[number]
    const { roots, cycleBreaks } = buildEmployeeTree(rows, (a: Row, b: Row) => {
      const rank = (HIERARCHY_RANK[a.jobTitle.level] ?? 99) - (HIERARCHY_RANK[b.jobTitle.level] ?? 99)
      return rank !== 0 ? rank : a.fullName.localeCompare(b.fullName, 'id')
    })

    let result: TreeNode<Row>[] = roots
    if (rootId) {
      const found = findNode(roots, rootId)
      if (!found) throw new HttpError(404, 'Karyawan root tidak ditemukan')
      result = [found]
    }

    return { data: result, meta: { totalEmployees: rows.length, rootCount: result.length, cycleBreaks } }
  },
}

function findNode<T extends { id: string; children: T[] }>(nodes: T[], id: string): T | undefined {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === id) return node
    stack.push(...node.children)
  }
  return undefined
}
