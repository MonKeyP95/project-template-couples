import type { Expense } from "./expense-types"
import { formatShortDate } from "./itinerary-types"

/** Minimal day shape needed for date-based attribution. */
export interface DayLocation {
  dayDate: string
  locationId: string | null
}

/** dayDate -> locationId, only for days filed under a location. */
export function dayLocationMap(days: DayLocation[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of days) {
    if (d.locationId) map[d.dayDate] = d.locationId
  }
  return map
}

/** Which location an expense belongs to: explicit tag > date-derived > null. */
export function expenseLocationId(
  expense: Pick<Expense, "locationId" | "dayDate">,
  dayMap: Record<string, string>,
): string | null {
  if (expense.locationId) return expense.locationId
  if (expense.dayDate && dayMap[expense.dayDate]) return dayMap[expense.dayDate]
  return null
}

export interface BudgetMove {
  id: string
  tripId: string
  fromLocationId: string | null
  toLocationId: string | null
  amountCents: number
  createdBy: string
  createdAt: string
}

/** Location date label, mirroring the itinerary header: the declared span when
 * both ends are set, else the range derived from the location's days. Null when
 * neither a span nor any days exist. */
export function locationDateLabel(
  startDate: string | null,
  endDate: string | null,
  dayDates: string[],
): string | null {
  if (startDate && endDate) {
    return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`
  }
  if (dayDates.length > 0) {
    const sorted = [...dayDates].sort()
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    return first === last
      ? formatShortDate(first)
      : `${formatShortDate(first)} – ${formatShortDate(last)}`
  }
  return startDate ? formatShortDate(startDate) : null
}

/** The location chip for a main-ledger row: effective attribution + whether tagged. */
export function effectiveLocation(
  expense: Pick<Expense, "locationId" | "dayDate">,
  dayMap: Record<string, string>,
  locationsById: Record<string, string>,
): { name: string | null; tagged: boolean } {
  const id = expenseLocationId(expense, dayMap)
  return {
    name: id ? locationsById[id] ?? null : null,
    tagged: expense.locationId !== null,
  }
}
