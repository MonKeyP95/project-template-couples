export const TZ_COOKIE = "tz"

/** "yyyy-mm-dd" for `now` rendered in the given IANA timezone. */
export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Device-local today, for use in client components. */
export function deviceToday(): string {
  return todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
}
