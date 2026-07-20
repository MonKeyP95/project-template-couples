// Pure per-trip journal: a raw, location-organized record of what a couple did
// and spent. No server imports (the *-types.ts split rule) — it takes
// already-fetched domain objects and returns a plain record.

import {
  EXPENSE_CATEGORIES,
  summarizeBudget,
  type BudgetSummary,
  type Expense,
} from "@/lib/trips/expense-types"
import {
  inferRatingCategory,
  type LearnedCategory,
} from "@/lib/preferences/couple-summary-types"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

export interface JournalEvent {
  text: string
  category: LearnedCategory
  rating?: number
  note?: string
}

export interface JournalExpense {
  title: string
  amountCents: number
  category: string
}

export interface JournalPreTripItem {
  title: string
  amountCents: number
}

export interface JournalLocation {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
  events: JournalEvent[]
  expenses: JournalExpense[]
}

export interface CategoryAmount {
  category: string
  amountCents: number
}

export interface JournalTotals {
  /** Actual (non-settlement) expenses + pre-trip amounts. */
  totalSpentCents: number
  perCategoryCents: CategoryAmount[]
  preTripCents: number
  /** Who-owes-whom, computed from actual expenses only (pre-trip has no payer). */
  settleUp: BudgetSummary
}

export interface JournalRecord {
  locations: JournalLocation[]
  unplacedSpend: JournalExpense[]
  preTrip: JournalPreTripItem[]
  totals: JournalTotals
  isEmpty: boolean
}

export interface JournalInput {
  locations: ItineraryLocation[]
  days: ItineraryDay[]
  expenses: Expense[]
  preTripItems: JournalPreTripItem[]
  memberIds: string[]
}

/** An expense's location: its explicit `locationId`, else the location whose
 * declared span contains its `dayDate`, else null (truly unplaced). Locations
 * with no declared span never catch date-only expenses. */
export function placeExpense(
  e: Expense,
  locations: ItineraryLocation[],
): string | null {
  if (e.locationId) return e.locationId
  const d = e.dayDate
  if (d) {
    const hit = locations.find(
      (l) => l.startDate && l.endDate && l.startDate <= d && d <= l.endDate,
    )
    if (hit) return hit.id
  }
  return null
}

/** Non-settlement spend summed per category, ordered by EXPENSE_CATEGORIES
 * (unknown categories last), with a trailing Pre-trip line when non-zero. */
export function perCategoryCents(
  actual: Expense[],
  preTripCents: number,
): CategoryAmount[] {
  const byCat = new Map<string, number>()
  for (const e of actual) {
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents)
  }
  const order = [...EXPENSE_CATEGORIES] as string[]
  const rank = (c: string) => {
    const i = order.indexOf(c)
    return i === -1 ? order.length : i
  }
  const rows = [...byCat.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, amountCents]) => ({ category, amountCents }))
  if (preTripCents !== 0) rows.push({ category: "Pre-trip", amountCents: preTripCents })
  return rows
}

function toJournalEvent(text: string, rating?: number, note?: string): JournalEvent {
  return {
    text,
    category: inferRatingCategory(text),
    ...(rating !== undefined ? { rating } : {}),
    ...(note ? { note } : {}),
  }
}

/** Assemble the raw journal. Pure. Settlements are excluded from content and
 * per-category totals but still feed settle-up via summarizeBudget. */
export function assembleJournal(input: JournalInput): JournalRecord {
  const { locations, days, expenses, preTripItems, memberIds } = input
  const actual = expenses.filter((e) => !e.isSettlement)

  const daysByLoc = new Map<string, ItineraryDay[]>()
  for (const d of days) {
    if (!d.locationId) continue
    const arr = daysByLoc.get(d.locationId) ?? []
    arr.push(d)
    daysByLoc.set(d.locationId, arr)
  }

  const expByLoc = new Map<string, JournalExpense[]>()
  const unplacedSpend: JournalExpense[] = []
  for (const e of actual) {
    const je: JournalExpense = {
      title: e.title,
      amountCents: e.amountCents,
      category: e.category,
    }
    const locId = placeExpense(e, locations)
    if (locId) {
      const arr = expByLoc.get(locId) ?? []
      arr.push(je)
      expByLoc.set(locId, arr)
    } else {
      unplacedSpend.push(je)
    }
  }

  const journalLocations: JournalLocation[] = locations
    .map((loc) => {
      const locDays = (daysByLoc.get(loc.id) ?? [])
        .slice()
        .sort((a, b) => (a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0))
      const events: JournalEvent[] = []
      for (const d of locDays) {
        for (const ev of d.events) {
          events.push(toJournalEvent(ev.text, ev.rating, ev.note))
        }
      }
      return {
        id: loc.id,
        name: loc.name,
        startDate: loc.startDate,
        endDate: loc.endDate,
        events,
        expenses: expByLoc.get(loc.id) ?? [],
      }
    })
    .filter((l) => l.events.length > 0 || l.expenses.length > 0)

  const preTrip = preTripItems.filter((p) => p.title.length > 0 || p.amountCents !== 0)
  const preTripCents = preTrip.reduce((s, p) => s + p.amountCents, 0)
  const actualTotal = actual.reduce((s, e) => s + e.amountCents, 0)

  const totals: JournalTotals = {
    totalSpentCents: actualTotal + preTripCents,
    perCategoryCents: perCategoryCents(actual, preTripCents),
    preTripCents,
    settleUp: summarizeBudget(expenses, memberIds),
  }

  const isEmpty =
    journalLocations.length === 0 && unplacedSpend.length === 0 && preTrip.length === 0

  return { locations: journalLocations, unplacedSpend, preTrip, totals, isEmpty }
}
