export interface CategoryRollup {
  category: string
  /** Sum of budget items in this category. */
  plannedCents: number
  /** Sum of non-settlement expenses in this category. */
  actualCents: number
}

/** Minimal expense shape the rollup reads; full `Expense` is assignable. */
export interface ExpenseSpend {
  category: string
  amountCents: number
  isSettlement: boolean
}

/** Minimal budget-item shape the rollup reads; full `BudgetItem` is assignable. */
export interface PlannedSpend {
  category: string
  amountCents: number
}

/**
 * Per-category planned vs actual for one trip. The category set is the union
 * of those appearing in planned items or actual expenses, ordered by
 * `catOrder` (the trip's category list) with any extras appended in first-seen
 * order. Settlements are excluded from actual spend.
 */
export function perCategoryRollup(
  expenses: ExpenseSpend[],
  budgetItems: PlannedSpend[],
  catOrder: string[],
): CategoryRollup[] {
  const planned = new Map<string, number>()
  for (const it of budgetItems) {
    planned.set(it.category, (planned.get(it.category) ?? 0) + it.amountCents)
  }

  const actual = new Map<string, number>()
  for (const e of expenses) {
    if (e.isSettlement) continue
    actual.set(e.category, (actual.get(e.category) ?? 0) + e.amountCents)
  }

  const ordered: string[] = []
  for (const cat of catOrder) {
    if (planned.has(cat) || actual.has(cat)) ordered.push(cat)
  }
  for (const cat of [...planned.keys(), ...actual.keys()]) {
    if (!ordered.includes(cat)) ordered.push(cat)
  }

  return ordered.map((category) => ({
    category,
    plannedCents: planned.get(category) ?? 0,
    actualCents: actual.get(category) ?? 0,
  }))
}
