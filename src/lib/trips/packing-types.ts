export interface PackingItem {
  id: string
  tripId: string
  category: string
  label: string
  done: boolean
  addedBy: string
  ownerId: string | null
  createdAt: string
}

export interface PackingCategory {
  id: string
  tripId: string
  name: string
  sortOrder: number
  ownerId: string | null
}

export interface PackingGroup {
  /** Null for an "orphan" group — items whose category has no row yet. */
  categoryId: string | null
  category: string
  items: PackingItem[]
}

/**
 * Render order follows the given `categories` array order (the query returns
 * them by sort_order, and optimistic drag reorders the array in place — so the
 * helper must NOT re-sort). Empty categories are included. Any category present
 * on an item but missing a row is appended as an orphan group at the end — this
 * keeps a Realtime item-INSERT under a not-yet-loaded category visible until
 * the next refocus.
 */
export function groupPackingItems(
  categories: PackingCategory[],
  items: PackingItem[],
): PackingGroup[] {
  const byName = new Map<string, PackingItem[]>()
  for (const item of items) {
    const arr = byName.get(item.category) ?? []
    arr.push(item)
    byName.set(item.category, arr)
  }
  const groups: PackingGroup[] = categories.map((c) => ({
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

export interface OwnerScope {
  categories: PackingCategory[]
  items: PackingItem[]
}

/**
 * Splits the trip's packing rows into the three views by owner. `null` owner is
 * shared; `meId` is the current user's personal list; `partnerId` (when present)
 * is the partner's. Pure — the client derives the three scopes on each render.
 */
export function partitionByOwner(
  categories: PackingCategory[],
  items: PackingItem[],
  meId: string,
  partnerId: string | null,
): { shared: OwnerScope; mine: OwnerScope; partner: OwnerScope } {
  const pick = (owner: string | null): OwnerScope => ({
    categories: categories.filter((c) => c.ownerId === owner),
    items: items.filter((i) => i.ownerId === owner),
  })
  return {
    shared: pick(null),
    mine: pick(meId),
    partner: partnerId ? pick(partnerId) : { categories: [], items: [] },
  }
}
