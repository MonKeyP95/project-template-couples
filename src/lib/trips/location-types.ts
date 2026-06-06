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
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
  start_date?: string | null
  end_date?: string | null
  budget_cents?: number | null
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    budgetCents: row.budget_cents ?? null,
  }
}
