export const ITINERARY_TONES = ["sea", "clay", "moss", "sand"] as const
export type ItineraryTone = (typeof ITINERARY_TONES)[number]

export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  /** Optional "HH:MM"-style end label. Omitted when absent. Cosmetic. */
  endTime?: string
  text: string
  /** Optional source/booking link. Omitted when absent. */
  url?: string
  /** Optional 1-5 rating. Omitted when unrated. */
  rating?: number
  /** Optional free note captured with a rating. Omitted when empty. */
  note?: string
  /** Optional expense category tag from the discovery door (e.g. "Food"). Drives
   * the default in the event's expense form; omitted when absent. */
  category?: string
}

export interface ItineraryDay {
  /** Row id — needed by edit/delete UI. */
  id: string
  /** Raw yyyy-mm-dd — needed by the date input. */
  dayDate: string
  /** 1-based ordinal padded to 2 digits ("01", "02"). Derived from sort position. */
  d: string
  /** 3-char weekday in UTC ("FRI"). */
  dow: string
  /** "Jun 12"-style short date in UTC. */
  date: string
  /** Day-of-month, no padding ("10"). */
  dom: string
  /** Short month ("Jun"); uppercase at the view. */
  mon: string
  title: string
  sub: string
  events: ItineraryEvent[]
  tag: string
  tone: ItineraryTone
  /** Shared id for days added as one multi-day span; null when ungrouped. */
  groupId: string | null
  /** Name of the multi-day block; null when unnamed or ungrouped. */
  groupName: string | null
  /** Location this day is filed under; null = a travel/transit day. */
  locationId: string | null
}

export interface ItineraryRow {
  id: string
  day_date: string
  title: string
  sub?: string | null
  /** Raw jsonb from the DB; parsed by rowToItineraryDay. */
  events?: unknown
  tag: string
  tone: string
  group_id?: string | null
  group_name?: string | null
  location_id?: string | null
}

const DOW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
})

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const DOM_FMT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  timeZone: "UTC",
})

const MON_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function toUtc(dayDate: string): Date {
  return new Date(`${dayDate}T00:00:00Z`)
}

/** Parse the raw jsonb `events` array into clean ItineraryEvent[]. Tolerates
 * null/malformed values and drops events with empty text. */
export function parseEvents(raw: unknown): ItineraryEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      ...(typeof e.endTime === "string" && e.endTime.length > 0
        ? { endTime: e.endTime }
        : {}),
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
      ...(typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5
        ? { rating: Math.round(e.rating) }
        : {}),
      ...(typeof e.note === "string" && e.note.length > 0 ? { note: e.note } : {}),
      ...(typeof e.category === "string" && e.category.length > 0
        ? { category: e.category }
        : {}),
    }))
    .filter((e) => e.text.length > 0)
}

/** Single row → ItineraryDay. `d` is a placeholder; pass through `withOrdinals` to set correctly. */
export function rowToItineraryDay(row: ItineraryRow): ItineraryDay {
  const utc = toUtc(row.day_date)
  return {
    id: row.id,
    dayDate: row.day_date,
    d: "",
    dow: DOW_FMT.format(utc),
    date: SHORT_DATE_FMT.format(utc),
    dom: DOM_FMT.format(utc),
    mon: MON_FMT.format(utc),
    title: row.title,
    sub: row.sub ?? "",
    events: parseEvents(row.events),
    tag: row.tag,
    tone: row.tone as ItineraryTone,
    groupId: row.group_id ?? null,
    groupName: row.group_name ?? null,
    locationId: row.location_id ?? null,
  }
}

/** Sort by dayDate ascending and re-pad `d` ordinals. Pure; safe for client-side use after Realtime deltas. */
export function withOrdinals(days: ItineraryDay[]): ItineraryDay[] {
  const sorted = [...days].sort((a, b) =>
    a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0,
  )
  return sorted.map((day, i) => ({
    ...day,
    d: String(i + 1).padStart(2, "0"),
  }))
}

/** yyyy-mm-dd dates strictly between `a` and `b` (both exclusive), ascending.
 * Empty when the two dates are adjacent, equal, or out of order. */
export function gapDates(a: string, b: string): string[] {
  const out: string[] = []
  const d = new Date(`${a}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  const end = new Date(`${b}T00:00:00Z`)
  while (d < end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** "Jun 12"-style short UTC date for a yyyy-mm-dd string. */
export function formatShortDate(dayDate: string): string {
  return SHORT_DATE_FMT.format(new Date(`${dayDate}T00:00:00Z`))
}

/** "" when untimed, "18:00" with only a start, "18:00 → 20:00" with a range. */
export function formatEventTime(time: string, endTime?: string): string {
  if (!time) return ""
  return endTime ? `${time} → ${endTime}` : time
}

/** All yyyy-mm-dd dates in [start, end] inclusive, ascending. Empty if start > end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export type DayZone = "past" | "today" | "future"

/** Zone a day by its date vs today (ISO yyyy-mm-dd string compare). */
export function dayZone(dayDate: string, today: string): DayZone {
  return dayDate < today ? "past" : dayDate > today ? "future" : "today"
}

/** True when today falls within [start, end] (inclusive). */
export function tripActive(today: string, start: string, end: string): boolean {
  return today >= start && today <= end
}

/** One-line summary for a day: the typed sub, else a cheap hint from the events
 * (the lone event's text, or "N events"), else "". Pure; safe server or client. */
export function daySummary(day: ItineraryDay): string {
  if (day.sub.trim()) return day.sub
  if (day.events.length === 0) return ""
  if (day.events.length === 1) return day.events[0].text
  return `${day.events.length} events`
}

/** Copy of `day` moved to `newDate` (yyyy-mm-dd) with the derived date labels
 * recomputed. `d` is untouched; re-pad with `withOrdinals` after reordering.
 * Used for the optimistic reorder update before the server round-trip. */
export function reassignDayDate(day: ItineraryDay, newDate: string): ItineraryDay {
  const utc = toUtc(newDate)
  return {
    ...day,
    dayDate: newDate,
    dow: DOW_FMT.format(utc),
    date: SHORT_DATE_FMT.format(utc),
    dom: DOM_FMT.format(utc),
    mon: MON_FMT.format(utc),
  }
}

/** Full trip day-id order (ascending by current date) with one location group's
 * members permuted into `groupOrderedIds`, every other day left in place. The
 * group's slots in the sorted array are filled, ascending, with
 * `groupOrderedIds` in order. Fed to reschedule_itinerary_days: only the
 * group's members change date, so the location's date span is unchanged. */
export function reorderWithinGroup(
  allDays: ItineraryDay[],
  groupOrderedIds: string[],
): string[] {
  const ids = [...allDays]
    .sort((a, b) => (a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0))
    .map((d) => d.id)
  const inGroup = new Set(groupOrderedIds)
  let g = 0
  return ids.map((id) => (inGroup.has(id) ? groupOrderedIds[g++] : id))
}

/** Effective date range of a location: its declared span unioned with any days.
 * null when there are neither declared dates nor days. Pure. */
export function effectiveRange(
  days: ItineraryDay[],
  declaredStart: string | null,
  declaredEnd: string | null,
): { start: string; end: string } | null {
  const dates = days.map((d) => d.dayDate)
  const lows = [declaredStart, ...dates].filter((v): v is string => Boolean(v))
  const highs = [declaredEnd, ...dates].filter((v): v is string => Boolean(v))
  if (!lows.length || !highs.length) return null
  return {
    start: lows.reduce((a, b) => (a < b ? a : b)),
    end: highs.reduce((a, b) => (a > b ? a : b)),
  }
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

/** Reorder a location's real days AND empty-day gaps as one sequence over the
 * effective date range, then re-lay onto the ascending dates. Slots are real
 * day ids or "empty:<date>" placeholders. `floorDate` (inclusive; "" = none)
 * drops earlier dates from the sequence so a live trip cannot reassign into the
 * past. Returns only the real days whose date changed. Pure; safe client-side
 * for the optimistic update. */
export function reorderRangeSlots(
  days: ItineraryDay[],
  rangeStart: string,
  rangeEnd: string,
  floorDate: string,
  activeId: string,
  overId: string,
): { id: string; date: string }[] {
  if (activeId === overId) return []
  const allDates = dateRange(rangeStart, rangeEnd).filter(
    (d) => !floorDate || d >= floorDate,
  )
  const idByDate = new Map(days.map((d) => [d.dayDate, d.id]))
  const dateById = new Map(days.map((d) => [d.id, d.dayDate]))
  const slots = allDates.map((date) => idByDate.get(date) ?? `empty:${date}`)
  const oldIndex = slots.indexOf(activeId)
  const newIndex = slots.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return []
  const moved = moveItem(slots, oldIndex, newIndex)
  const changes: { id: string; date: string }[] = []
  moved.forEach((slot, i) => {
    if (slot.startsWith("empty:")) return
    const newDate = allDates[i]
    if (dateById.get(slot) !== newDate) changes.push({ id: slot, date: newDate })
  })
  return changes
}
