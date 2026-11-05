/** What the on-the-road budget card compares: today, this trip-week, or the trip so far. */
export type BudgetPeriod = "day" | "week" | "trip"

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["day", "week", "trip"]

export function isBudgetPeriod(v: string): v is BudgetPeriod {
  return (BUDGET_PERIODS as readonly string[]).includes(v)
}
