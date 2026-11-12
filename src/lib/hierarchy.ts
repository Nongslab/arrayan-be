/**
 * Apakah menjadikan `newParentId` sebagai induk dari `id` membentuk siklus?
 * Dipakai untuk hierarki departemen (parentId) dan atasan karyawan (managerId).
 * `parentOf` = peta id → id induk untuk seluruh node.
 */
export function wouldCreateCycle(
  parentOf: ReadonlyMap<string, string | null>,
  id: string,
  newParentId: string,
): boolean {
  const visited = new Set<string>()
  let current: string | null | undefined = newParentId
  while (current) {
    if (current === id || visited.has(current)) return true
    visited.add(current)
    current = parentOf.get(current) ?? null
  }
  return false
}
