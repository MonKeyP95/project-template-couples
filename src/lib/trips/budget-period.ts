import type { BudgetPace, PaceDay } from "./budget-pace"

/** What the on-the-road budget card compares: today, this trip-week, or the trip so far. */
export type BudgetPeriod = "day" | "week" | "trip"

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["day", "week", "trip"]

export function isBudgetPeriod(v: string): v is BudgetPeriod {
  return (BUDGET_PERIODS as readonly string[]).includes(v)
}

export interface PeriodCheck {
  period: BudgetPeriod
  plannedCents: number
  spentCents: number
  /** Spent minus planned; positive = over. */
  deltaCents: number
  /** The last-logged watermark the figure runs to; null for a day or nothing logged. */
  asOf: string | null
  /** Week/trip only: nothing logged in the period yet, so there is no verdict. */
  nothingLogged: boolean
}

const WEEK_DAYS = 7

function sum(days: PaceDay[], key: "plannedCents" | "spentCents"): number {
  return Math.round(days.reduce((s, d) => s + d[key], 0))
}

function check(period: BudgetPeriod, days: PaceDay[], asOf: string | null): PeriodCheck {
  const plannedCents = sum(days, "plannedCents")
  const spentCents = sum(days, "spentCents")
  return { period, plannedCents, spentCents, deltaCents: spentCents - plannedCents, asOf, nothingLogged: false }
}

/**
 * The over/under for one period. Day is today alone, no watermark. Week is the
 * current trip-week (days 1-7, 8-14, ...) up to the last logged day, so an
 * unlogged day never reads as money saved. Trip is `budgetPace`'s own figure.
 */
export function periodCheck(pace: BudgetPace, period: BudgetPeriod, today: string): PeriodCheck {
  if (period === "day") return check("day", pace.byDay.filter((d) => d.date === today), null)
  if (period === "trip") {
    return {
      period,
      plannedCents: pace.plannedToDateCents,
      spentCents: pace.spentToDateCents,
      deltaCents: pace.deltaCents,
      asOf: pace.lastLogged,
      nothingLogged: pace.lastLogged === null,
    }
  }
  const start = Math.floor((pace.dayIndex - 1) / WEEK_DAYS) * WEEK_DAYS
  const week = pace.byDay.slice(start, start + WEEK_DAYS)
  const mark = pace.lastLogged
  if (!mark || mark < week[0].date) {
    return { ...check("week", [], null), nothingLogged: true }
  }
  return check("week", week.filter((d) => d.date <= mark), mark)
}
