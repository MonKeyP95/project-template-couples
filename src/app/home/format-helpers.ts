/**
 * Days from today until a future date (UTC).
 * Returns null if startDate is null. Returns 0 if today >= startDate.
 */
export function daysUntil(startDate: string | null): number | null {
  if (!startDate) return null
  const start = new Date(`${startDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  return Math.max(0, Math.ceil((start.getTime() - todayUtc) / 86_400_000))
}

/**
 * Day number within a trip (1-based) for the now-state countdown
 * (e.g. "day 3 / 8"). Returns null if dates aren't set.
 */
export function dayWithinTrip(
  startDate: string | null,
  endDate: string | null,
): { day: number; total: number } | null {
  if (!startDate || !endDate) return null
  const s = new Date(`${startDate}T00:00:00Z`)
  const e = new Date(`${endDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  const total = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  const day = Math.min(
    total,
    Math.max(1, Math.round((todayUtc - s.getTime()) / 86_400_000) + 1),
  )
  return { day, total }
}
