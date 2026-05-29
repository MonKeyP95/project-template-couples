export interface PackingItem {
  id: string
  tripId: string
  category: string
  label: string
  done: boolean
  addedBy: string
  createdAt: string
}

export interface PackingCategory {
  id: string
  tripId: string
  name: string
  sortOrder: number
}

export interface PackingGroup {
  category: string
  items: PackingItem[]
}

/**
 * Group items by category, preserving first-seen order. When the items are
 * already sorted by `created_at` ascending, this yields categories in the
 * order their earliest item was added.
 */
export function groupPackingItems(items: PackingItem[]): PackingGroup[] {
  const groups = new Map<string, PackingItem[]>()
  for (const item of items) {
    const arr = groups.get(item.category) ?? []
    arr.push(item)
    groups.set(item.category, arr)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}
