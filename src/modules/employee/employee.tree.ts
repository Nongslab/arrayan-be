/**
 * Membangun pohon organisasi dari relasi self-referencing `managerId` (US-2.4).
 * Fungsi murni: tidak menyentuh database → mudah di-unit-test.
 */

export interface TreeSource {
  id: string
  managerId: string | null
}

export type TreeNode<T extends TreeSource> = T & { children: TreeNode<T>[] }

export interface TreeResult<T extends TreeSource> {
  roots: TreeNode<T>[]
  /**
   * Karyawan yang relasi atasannya membentuk siklus (data korup, mis. A → B → A).
   * Relasinya diputus dan karyawan tersebut dijadikan root agar tidak hilang dari pohon.
   */
  cycleBreaks: string[]
}

/**
 * - Karyawan tanpa atasan, atau atasannya tidak ada di `rows`, menjadi root (multi-root).
 * - Siklus dideteksi defensif: node yang tidak terjangkau dari root mana pun berada di siklus.
 * - `compare` mengurutkan root & children (default: urutan input).
 */
export function buildEmployeeTree<T extends TreeSource>(
  rows: readonly T[],
  compare?: (a: T, b: T) => number,
): TreeResult<T> {
  const nodes = new Map<string, TreeNode<T>>()
  for (const row of rows) nodes.set(row.id, { ...row, children: [] })

  const roots: TreeNode<T>[] = []
  for (const node of nodes.values()) {
    const parent = node.managerId ? nodes.get(node.managerId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  const reachable = new Set<string>()
  const markReachable = (start: TreeNode<T>) => {
    const stack = [start]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (reachable.has(current.id)) continue
      reachable.add(current.id)
      stack.push(...current.children)
    }
  }
  roots.forEach(markReachable)

  // Node sisa ada di dalam siklus (atau di bawahnya). Putus satu tautan per siklus.
  const cycleBreaks: string[] = []
  for (const node of nodes.values()) {
    if (reachable.has(node.id)) continue
    const parent = node.managerId ? nodes.get(node.managerId) : undefined
    if (parent) parent.children = parent.children.filter((child) => child !== node)
    roots.push(node)
    cycleBreaks.push(node.id)
    markReachable(node)
  }

  if (compare) {
    const sortDeep = (list: TreeNode<T>[]) => {
      list.sort(compare)
      list.forEach((child) => sortDeep(child.children))
    }
    sortDeep(roots)
  }

  return { roots, cycleBreaks }
}

/** Urutan level hierarki jabatan (PRD: Management → Sr. Manager → Manager → Supervisor → Staff). */
export const HIERARCHY_RANK: Record<string, number> = {
  MANAGEMENT: 0,
  SR_MANAGER: 1,
  MANAGER: 2,
  SUPERVISOR: 3,
  STAFF: 4,
}
