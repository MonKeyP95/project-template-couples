import type { Expense } from "./expense-types"
import type { ItineraryLocation } from "./location-types"

/** Minimal day shape needed for date-based attribution. */
export interface DayLocation {
  dayDate: string
  locationId: string | null
}

/** One spend bucket: a location, or the synthetic Unassigned bucket (id null). */
export interface Envelope {
  locationId: string | null
  name: string
  /** null = no target set; always null for Unassigned. */
  budgetCents: number | null
  spentCents: number
}

export interface EnvelopeSummary {
  /** One per location, in the order locations is supplied. Unassigned is tracked separately. */
  envelopes: Envelope[]
  /** Sum of location targets. */
  allocatedCents: number
  /** master - allocated; negative means over-allocated. */
  unallocatedCents: number
  /** Non-settlement spend that lands in no location. */
  unassignedSpentCents: number
}

export interface MonthGroup {
  /** "2026-06" for a dated month, "undated" for the no-date bucket. */
  key: string
  /** "Jun 2026" or "Undated". */
  label: string
  spentCents: number
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

/** Per-location spend + allocation rollup against the master trip budget. */
export function summarizeEnvelopes(
  expenses: Expense[],
  locations: ItineraryLocation[],
  days: DayLocation[],
  masterBudgetCents: number,
): EnvelopeSummary {
  const dayMap = dayLocationMap(days)
  const spent: Record<string, number> = {}
  let unassignedSpentCents = 0

  for (const e of expenses) {
    if (e.isSettlement) continue
    const loc = expenseLocationId(e, dayMap)
    if (loc) spent[loc] = (spent[loc] ?? 0) + e.amountCents
    else unassignedSpentCents += e.amountCents
  }

  const envelopes: Envelope[] = locations.map((l) => ({
    locationId: l.id,
    name: l.name,
    budgetCents: l.budgetCents,
    spentCents: spent[l.id] ?? 0,
  }))

  const allocatedCents = locations.reduce(
    (sum, l) => sum + (l.budgetCents ?? 0),
    0,
  )

  return {
    envelopes,
    allocatedCents,
    unallocatedCents: masterBudgetCents - allocatedCents,
    unassignedSpentCents,
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function monthLabel(ym: string): string {
  return MONTH_YEAR.format(new Date(`${ym}-01T00:00:00Z`))
}

/** Same expenses, grouped by calendar month. Undated spend sorts last. */
export function groupByMonth(expenses: Expense[]): MonthGroup[] {
  const totals = new Map<string, number>()
  for (const e of expenses) {
    if (e.isSettlement) continue
    const key = e.dayDate ? e.dayDate.slice(0, 7) : "undated"
    totals.set(key, (totals.get(key) ?? 0) + e.amountCents)
  }

  const keys = [...totals.keys()].sort((a, b) => {
    if (a === "undated") return 1
    if (b === "undated") return -1
    return a < b ? -1 : a > b ? 1 : 0
  })

  return keys.map((key) => ({
    key,
    label: key === "undated" ? "Undated" : monthLabel(key),
    spentCents: totals.get(key) ?? 0,
  }))
}
