import { dateOfIndex } from "@/lib/trips/itinerary-types"

export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
  /** Declared start of the location's span; null = implied by its days. */
  startDate: string | null
  /** Declared end of the location's span; null = implied by its days. */
  endDate: string | null
  /** Stored span as 1-based day numbers; null = implied by its days. */
  startIndex: number | null
  endIndex: number | null
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
  start_index?: number | null
  end_index?: number | null
  budget_cents?: number | null
  currency?: string | null
}

/** Row -> location; span dates are derived from the indexes and the trip start. */
export function rowToLocation(
  row: ItineraryLocationRow,
  startDate: string | null,
): ItineraryLocation {
  const startIndex = row.start_index ?? null
  const endIndex = row.end_index ?? null
  const dated = startDate !== null && startIndex !== null && endIndex !== null
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: dated ? dateOfIndex(startIndex, startDate) : null,
    endDate: dated ? dateOfIndex(endIndex, startDate) : null,
    startIndex,
    endIndex,
    budgetCents: row.budget_cents ?? null,
    currency: row.currency ?? null,
  }
}
