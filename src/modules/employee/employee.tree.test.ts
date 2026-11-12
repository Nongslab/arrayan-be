import { describe, expect, it } from 'vitest'
import { buildEmployeeTree } from './employee.tree.js'

const row = (id: string, managerId: string | null, name = id) => ({ id, managerId, name })
const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id)

describe('buildEmployeeTree', () => {
  it('membangun hierarki bersarang dari managerId', () => {
    const { roots, cycleBreaks } = buildEmployeeTree([
      row('CEO', null),
      row('MGR', 'CEO'),
      row('SPV', 'MGR'),
      row('STAFF1', 'SPV'),
      row('STAFF2', 'SPV'),
    ])

    expect(ids(roots)).toEqual(['CEO'])
    expect(ids(roots[0]!.children)).toEqual(['MGR'])
    expect(ids(roots[0]!.children[0]!.children[0]!.children)).toEqual(['STAFF1', 'STAFF2'])
    expect(cycleBreaks).toEqual([])
  })

  it('mendukung multi-root dan atasan yang tidak ada di data', () => {
    const { roots } = buildEmployeeTree([row('A', null), row('B', null), row('C', 'MISSING')])
    expect(ids(roots)).toEqual(['A', 'B', 'C'])
  })

  it('setiap karyawan muncul tepat sekali', () => {
    const rows = [row('A', null), row('B', 'A'), row('C', 'A'), row('D', 'C')]
    const { roots } = buildEmployeeTree(rows)
    const seen: string[] = []
    const walk = (nodes: typeof roots) => nodes.forEach((n) => (seen.push(n.id), walk(n.children)))
    walk(roots)
    expect(seen.sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('memutus siklus tanpa kehilangan node', () => {
    // A → B → C → A (siklus), D di bawah C
    const { roots, cycleBreaks } = buildEmployeeTree([row('A', 'C'), row('B', 'A'), row('C', 'B'), row('D', 'C')])

    expect(cycleBreaks).toHaveLength(1)
    expect(roots).toHaveLength(1)
    const seen: string[] = []
    const walk = (nodes: typeof roots) => nodes.forEach((n) => (seen.push(n.id), walk(n.children)))
    walk(roots)
    expect(seen.sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('karyawan yang menjadi atasan dirinya sendiri dijadikan root', () => {
    const { roots, cycleBreaks } = buildEmployeeTree([row('A', 'A')])
    expect(ids(roots)).toEqual(['A'])
    expect(cycleBreaks).toEqual([])
  })

  it('mengurutkan root dan children dengan comparator', () => {
    const { roots } = buildEmployeeTree(
      [row('1', null, 'Zaki'), row('2', null, 'Ani'), row('3', '2', 'Rudi'), row('4', '2', 'Budi')],
      (a, b) => a.name.localeCompare(b.name),
    )
    expect(roots.map((n) => n.name)).toEqual(['Ani', 'Zaki'])
    expect(roots[0]!.children.map((n) => n.name)).toEqual(['Budi', 'Rudi'])
  })
})
