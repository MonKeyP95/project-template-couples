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

/** "HH:MM" (24h) for `at` rendered in the given IANA timezone. */
export function clockInTimeZone(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at)
}
