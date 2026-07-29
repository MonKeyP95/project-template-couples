export type Remaining = {
  months: number
  days: number
  hours: number
  minutes: number
}

/** Local midnight of a YYYY-MM-DD date string. */
export function localMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** `base` advanced by `n` calendar months, clamped to the last day of the
 *  target month so 31 Jan + 1 month is 28 Feb, not 3 Mar. */
function addMonths(base: Date, n: number): Date {
  const d = new Date(base)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

/** Time from `now` until local midnight of `startDate`, split into whole
 *  calendar months plus the leftover days / hours / minutes. Null once that
 *  moment has passed, which is what makes the countdown disappear. */
export function remainingUnits(startDate: string, now: Date): Remaining | null {
  const target = localMidnight(startDate)
  if (target.getTime() <= now.getTime()) return null

  let months = 0
  while (addMonths(now, months + 1).getTime() <= target.getTime()) {
    months += 1
  }

  const rest = target.getTime() - addMonths(now, months).getTime()
  const totalMinutes = Math.floor(rest / 60_000)

  return {
    months,
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
  }
}
