import type { BudgetPace, PaceDay } from "./budget-pace"

/** What the on-the-road budget card compares: today, this trip-week, or the trip so far. */
export type BudgetPeriod = "day" | "week" | "trip"

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["day", "week", "trip"]

export function isBudgetPeriod(v: string): v is BudgetPeriod {
  return (BUDGET_PERIODS as readonly string[]).includes(v)
}

export interface PeriodCheck {
  period: BudgetPeriod
  /** The period's budget: today's share, this trip-week's, or the whole estimate. */
  plannedCents: number
  spentCents: number
  /** Spent minus planned; positive = over. */
  deltaCents: number
}

/** The whole trip's figures: the couple's estimate and everything spent. */
export interface TripTotal {
  budgetCents: number
  spentCents: number
}

const WEEK_DAYS = 7

function check(period: BudgetPeriod, days: PaceDay[]): PeriodCheck {
  const plannedCents = Math.round(days.reduce((s, d) => s + d.plannedCents, 0))
  const spentCents = Math.round(days.reduce((s, d) => s + d.spentCents, 0))
  return { period, plannedCents, spentCents, deltaCents: spentCents - plannedCents }
}

/**
 * One budget minus what was spent against it. Day: today's share. Week: the
 * current trip-week's share (days 1-7, 8-14, ...). Trip: the whole estimate
 * against everything spent, before-you-go costs included.
 */
export function periodCheck(
  pace: BudgetPace,
  period: BudgetPeriod,
  today: string,
  total: TripTotal,
): PeriodCheck {
  if (period === "trip") {
    return {
      period,
      plannedCents: total.budgetCents,
      spentCents: total.spentCents,
      deltaCents: total.spentCents - total.budgetCents,
    }
  }
  if (period === "day") return check("day", pace.byDay.filter((d) => d.date === today))
  const start = Math.floor((pace.dayIndex - 1) / WEEK_DAYS) * WEEK_DAYS
  return check("week", pace.byDay.slice(start, start + WEEK_DAYS))
}
