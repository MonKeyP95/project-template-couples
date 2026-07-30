export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
  /** Declared start of the location's span; null = implied by its days. */
  startDate: string | null
  /** Declared end of the location's span; null = implied by its days. */
  endDate: string | null
  /** Per-location budget target in cents; null = no target set. */
  budgetCents: number | null
  /** What you spend here; null = the trip's currency. Pre-fills the expense
   * form only -- it never changes how anything is totalled. */
  currency: string | null
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
  start_date?: string | null
  end_date?: string | null
  budget_cents?: number | null
  currency?: string | null
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    budgetCents: row.budget_cents ?? null,
    currency: row.currency ?? null,
  }
}
