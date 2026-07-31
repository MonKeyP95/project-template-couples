import { isBufferSubject, type BudgetItem } from "./budget-item-types"
import { computeTripDays } from "./trip-days"

/** Reserved category excluded from the tracker; mirrors budget-tab.tsx. */
const PRE_TRIP = "Pre-trip"
const DAY_MS = 86_400_000
/** A tracker "month" is four whole weeks, so months drill down into weeks evenly. */
const MONTH_DAYS = 28

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
})
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** "WED" */
export function weekdayLabel(date: string): string {
  return WEEKDAY_FMT.format(new Date(`${date}T00:00:00Z`)).toUpperCase()
}

/** "28 Jul" -- day before month, per house date order. */
export function dayLabel(date: string): string {
  return DAY_FMT.format(new Date(`${date}T00:00:00Z`))
}

/** Minimal expense shape; pass `homeCents(e)` as `amountCents`. */
export interface PaceExpense {
  category: string
  dayDate: string | null
  isSettlement: boolean
  amountCents: number
}

export type PaceBucketUnit = "day" | "week" | "month"

export interface PaceBucket {
  label: string
  startDate: string
  endDate: string
  plannedCents: number
  spentCents: number
  status: "past" | "current" | "future"
  /** False when the whole bucket sits past the last-logged watermark. */
  logged: boolean
  /** One level down: days inside a week, weeks inside a month. Empty for a day. */
  children: PaceBucket[]
}

export interface BudgetPace {
  /** Planned spend through the watermark. */
  plannedToDateCents: number
  /** Actual spend through the watermark. */
  spentToDateCents: number
  /** Positive = over budget. */
  deltaCents: number
  dayIndex: number
  tripDays: number
  unit: PaceBucketUnit
  buckets: PaceBucket[]
  /** Latest day carrying an expense; null when nothing is logged yet. */
  lastLogged: string | null
  unloggedDays: number
  source: "items" | "flat"
  /** The tracker's denominator: planned items, or the budget less pre-trip. */
  onTheRoadBudgetCents: number
  preTripPlannedCents: number
}

export interface BudgetPaceInput {
  startDate: string | null
  endDate: string | null
  today: string
  plannedBudgetCents: number
  budgetItems: BudgetItem[]
  expenses: PaceExpense[]
  /** Location id -> its yyyy-mm-dd dates. */
  locationDays: Record<string, string[]>
}

function toUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime()
}

function addDays(date: string, n: number): string {
  return new Date(toUtc(date) + n * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

function bucketUnit(tripDays: number): PaceBucketUnit {
  if (tripDays <= 9) return "day"
  if (tripDays <= 42) return "week"
  return "month"
}

/**
 * The days an item's cost belongs to: its own dates, else its location's days,
 * else the whole trip. Dates outside the trip window drop out -- the matching
 * expense is excluded too, so both sides stay comparable.
 */
function itemSpan(
  item: BudgetItem,
  tripDates: string[],
  locationDays: Record<string, string[]>,
): string[] {
  if (item.whenStart) {
    const end = item.whenEnd ?? item.whenStart
    return tripDates.filter((d) => d >= item.whenStart! && d <= end)
  }
  if (item.locationId) {
    const within = (locationDays[item.locationId] ?? []).filter((d) =>
      tripDates.includes(d),
    )
    if (within.length > 0) return within
  }
  return tripDates
}

/**
 * How an item's total lands across its span. `amount_cents` is already the
 * resolved total (unit price x quantity), so this only ever divides.
 */
function spreadItem(item: BudgetItem, span: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (span.length === 0) return out
  if (item.freq === "once") {
    out.set(span[0], item.amountCents)
    return out
  }
  const per = item.amountCents / span.length
  for (const date of span) out.set(date, per)
  return out
}

function sumThrough(byDay: Map<string, number>, dates: string[], end: string): number {
  let total = 0
  for (const date of dates) {
    if (date <= end) total += byDay.get(date) ?? 0
  }
  return total
}

function chunk(dates: string[], size: number): string[][] {
  const out: string[][] = []
  for (let i = 0; i < dates.length; i += size) out.push(dates.slice(i, i + size))
  return out
}

function makeBucket(
  label: string,
  dates: string[],
  plannedByDay: Map<string, number>,
  spentByDay: Map<string, number>,
  today: string,
  watermark: string,
  children: PaceBucket[],
): PaceBucket {
  const startDate = dates[0]
  const endDate = dates[dates.length - 1]
  let plannedCents = 0
  let spentCents = 0
  for (const date of dates) {
    if (date > watermark) continue
    plannedCents += plannedByDay.get(date) ?? 0
    spentCents += spentByDay.get(date) ?? 0
  }
  return {
    label,
    startDate,
    endDate,
    plannedCents: Math.round(plannedCents),
    spentCents: Math.round(spentCents),
    status: endDate < today ? "past" : startDate > today ? "future" : "current",
    logged: startDate <= watermark,
    children,
  }
}

function buildBuckets(
  tripDates: string[],
  unit: PaceBucketUnit,
  plannedByDay: Map<string, number>,
  spentByDay: Map<string, number>,
  today: string,
  watermark: string,
): PaceBucket[] {
  const day = (dates: string[]) =>
    makeBucket(weekdayLabel(dates[0]), dates, plannedByDay, spentByDay, today, watermark, [])

  if (unit === "day") return tripDates.map((d) => day([d]))

  const weeks = chunk(tripDates, 7).map((dates, i) =>
    makeBucket(
      `WEEK ${i + 1}`,
      dates,
      plannedByDay,
      spentByDay,
      today,
      watermark,
      dates.map((d) => day([d])),
    ),
  )
  if (unit === "week") return weeks

  return chunk(tripDates, MONTH_DAYS).map((dates, i) =>
    makeBucket(
      `MONTH ${i + 1}`,
      dates,
      plannedByDay,
      spentByDay,
      today,
      watermark,
      weeks.filter((w) => w.startDate >= dates[0] && w.startDate <= dates[dates.length - 1]),
    ),
  )
}

/**
 * Where a running trip stands against its budget. Null when there is nothing to
 * track: no dates, no budget, or today outside the trip window.
 *
 * The delta is measured at the last-logged watermark, not at today -- comparing
 * spend-through-Tuesday against plan-through-Thursday would report an
 * underspend that is only unlogged spending.
 */
export function budgetPace(input: BudgetPaceInput): BudgetPace | null {
  const { startDate, endDate, today, plannedBudgetCents } = input
  if (!startDate || !endDate) return null
  if (plannedBudgetCents <= 0) return null
  if (today < startDate || today > endDate) return null

  const tripDays = computeTripDays(startDate, endDate)
  const tripDates = Array.from({ length: tripDays }, (_, i) => addDays(startDate, i))

  const preTripPlannedCents = input.budgetItems
    .filter((it) => it.category === PRE_TRIP)
    .reduce((sum, it) => sum + it.amountCents, 0)
  const tripItems = input.budgetItems.filter(
    (it) => it.category !== PRE_TRIP && !isBufferSubject(it.subject),
  )
  const source: "items" | "flat" = tripItems.length > 0 ? "items" : "flat"

  const plannedByDay = new Map<string, number>()
  if (source === "items") {
    for (const item of tripItems) {
      const span = itemSpan(item, tripDates, input.locationDays)
      for (const [date, cents] of spreadItem(item, span)) {
        plannedByDay.set(date, (plannedByDay.get(date) ?? 0) + cents)
      }
    }
  }

  const onTheRoadBudgetCents =
    source === "items"
      ? Math.round(Array.from(plannedByDay.values()).reduce((sum, c) => sum + c, 0))
      : Math.max(0, plannedBudgetCents - preTripPlannedCents)

  if (source === "flat") {
    const per = onTheRoadBudgetCents / tripDays
    for (const date of tripDates) plannedByDay.set(date, per)
  }

  const spentByDay = new Map<string, number>()
  let lastLogged: string | null = null
  for (const e of input.expenses) {
    if (e.isSettlement) continue
    if (e.category === PRE_TRIP) continue
    if (!e.dayDate) continue
    if (e.dayDate < startDate || e.dayDate > endDate) continue
    spentByDay.set(e.dayDate, (spentByDay.get(e.dayDate) ?? 0) + e.amountCents)
    if (e.dayDate <= today && (lastLogged === null || e.dayDate > lastLogged)) {
      lastLogged = e.dayDate
    }
  }

  // Nothing logged: the watermark sits before day 1, so every figure reads zero
  // rather than crediting the couple with an underspend.
  const watermark = lastLogged ?? addDays(startDate, -1)
  const plannedToDateCents = Math.round(sumThrough(plannedByDay, tripDates, watermark))
  const spentToDateCents = Math.round(sumThrough(spentByDay, tripDates, watermark))

  return {
    plannedToDateCents,
    spentToDateCents,
    deltaCents: spentToDateCents - plannedToDateCents,
    dayIndex: daysBetween(startDate, today) + 1,
    tripDays,
    unit: bucketUnit(tripDays),
    buckets: buildBuckets(
      tripDates,
      bucketUnit(tripDays),
      plannedByDay,
      spentByDay,
      today,
      watermark,
    ),
    lastLogged,
    unloggedDays: lastLogged
      ? daysBetween(lastLogged, today)
      : daysBetween(startDate, today) + 1,
    source,
    onTheRoadBudgetCents,
    preTripPlannedCents,
  }
}
