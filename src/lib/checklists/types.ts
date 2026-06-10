export interface Checklist {
  id: string
  workspaceId: string
  name: string
  slug: string
}

/** A checklist plus its progress counts, for the overview list. */
export interface ChecklistSummary extends Checklist {
  total: number
  done: number
}

export interface ChecklistItem {
  id: string
  checklistId: string
  category: string
  label: string
  done: boolean
  addedBy: string
  createdAt: string
}

export interface ChecklistCategory {
  id: string
  checklistId: string
  name: string
  sortOrder: number
}

export interface ChecklistGroup {
  /** Null for an "orphan" group — items whose category has no row yet. */
  categoryId: string | null
  category: string
  items: ChecklistItem[]
}

/**
 * Group items under their categories, preserving the given `categories` order.
 * Empty categories are kept; any item category missing a row is appended as an
 * orphan group (keeps a Realtime INSERT under a not-yet-loaded category visible
 * until the next refresh). Mirrors groupPackingItems.
 */
export function groupChecklistItems(
  categories: ChecklistCategory[],
  items: ChecklistItem[],
): ChecklistGroup[] {
  const byName = new Map<string, ChecklistItem[]>()
  for (const item of items) {
    const arr = byName.get(item.category) ?? []
    arr.push(item)
    byName.set(item.category, arr)
  }
  const groups: ChecklistGroup[] = categories.map((c) => ({
    categoryId: c.id,
    category: c.name,
    items: byName.get(c.name) ?? [],
  }))
  const known = new Set(categories.map((c) => c.name))
  for (const [name, list] of byName) {
    if (!known.has(name)) {
      groups.push({ categoryId: null, category: name, items: list })
    }
  }
  return groups
}
