export interface DayGroup<T> {
  /** null = the undated group, always last. */
  dayDate: string | null
  /** Sum of the group's non-settlement `cents`. */
  totalCents: number
  rows: T[]
}

/** Ledger rows grouped by day: today and past days newest first, then future
 * days soonest first, then undated rows in one group. Newest entry first
 * within a day. */
export function groupByDay<
  T extends { dayDate: string | null; createdAt: string; isSettlement: boolean; cents: number },
>(rows: T[], today: string): DayGroup<T>[] {
  const byDay = new Map<string | null, T[]>()
  for (const row of rows) byDay.set(row.dayDate, [...(byDay.get(row.dayDate) ?? []), row])

  const days = [...byDay.keys()].filter((d): d is string => d !== null).sort()
  const pastAndToday = days.filter((d) => d <= today).reverse()
  const future = days.filter((d) => d > today)
  const dated = [...pastAndToday, ...future]
  const keys: (string | null)[] = byDay.has(null) ? [...dated, null] : dated

  return keys.map((dayDate) => {
    const dayRows = [...byDay.get(dayDate)!].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
    const totalCents = dayRows
      .filter((r) => !r.isSettlement)
      .reduce((sum, r) => sum + r.cents, 0)
    return { dayDate, totalCents, rows: dayRows }
  })
}
