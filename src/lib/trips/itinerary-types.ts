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
  /** Optional free-text details — address, booking name, "cash only". Shown
   * inside an expanded day and on the road, never in a public share. */
  details?: string
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
  /** Raw yyyy-mm-dd, derived from dayIndex and the trip start; null on a dream. */
  dayDate: string | null
  /** 1-based day number in the trip; the stored position. */
  dayIndex: number
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
  day_index: number
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

const DAY_MS = 86_400_000

/** 1-based day number of `dayDate` in a trip that starts on `startDate`. */
export function dayIndexOf(dayDate: string, startDate: string): number {
  return Math.round((toUtc(dayDate).getTime() - toUtc(startDate).getTime()) / DAY_MS) + 1
}

/** Day number for a date input's value; null when empty or unparseable (a
 * browser accepts years like 20266, which no Date can hold). */
export function toDayIndex(value: string, startDate: string): number | null {
  if (!value) return null
  const i = dayIndexOf(value, startDate)
  return Number.isFinite(i) ? i : null
}

/** yyyy-mm-dd of day `dayIndex` in a trip that starts on `startDate`. */
export function dateOfIndex(dayIndex: number, startDate: string): string {
  const d = toUtc(startDate)
  d.setUTCDate(d.getUTCDate() + dayIndex - 1)
  return d.toISOString().slice(0, 10)
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
      ...(typeof e.details === "string" && e.details.length > 0
        ? { details: e.details }
        : {}),
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

/** Label fields for day `dayIndex`: its calendar date on a dated trip, its
 * position ("Day 3") on a dream. */
function positionFields(
  dayIndex: number,
  startDate: string | null,
): Pick<ItineraryDay, "dayDate" | "dow" | "date" | "dom" | "mon"> {
  if (startDate === null) {
    return { dayDate: null, dow: "", date: `Day ${dayIndex}`, dom: String(dayIndex), mon: "Day" }
  }
  const dayDate = dateOfIndex(dayIndex, startDate)
  const utc = toUtc(dayDate)
  return {
    dayDate,
    dow: DOW_FMT.format(utc),
    date: SHORT_DATE_FMT.format(utc),
    dom: DOM_FMT.format(utc),
    mon: MON_FMT.format(utc),
  }
}

/** "1 Mar" on a dated trip, "Day 3" on a dream. */
export function positionLabel(dayIndex: number, startDate: string | null): string {
  return positionFields(dayIndex, startDate).date
}

/** True for a day on a dated trip. */
export function isDated(day: ItineraryDay): day is ItineraryDay & { dayDate: string } {
  return day.dayDate !== null
}

/** A Realtime row → ItineraryDay. Rows carry both date and number until step 4:
 * a partner's start-date change arrives as rows whose dates hold while their
 * numbers shift, so a dated row's start is read off the row rather than the
 * possibly stale prop. A dream, or a row with no date, uses the prop. */
export function liveRowToItineraryDay(
  row: ItineraryRow & { day_date: string | null },
  tripStartDate: string | null,
): ItineraryDay {
  const start =
    tripStartDate !== null && row.day_date
      ? dateOfIndex(2 - row.day_index, row.day_date)
      : tripStartDate
  return rowToItineraryDay(row, start)
}

/** Single row → ItineraryDay. `d` is a placeholder; pass through `withOrdinals` to set correctly. */
export function rowToItineraryDay(row: ItineraryRow, startDate: string | null): ItineraryDay {
  return {
    id: row.id,
    ...positionFields(row.day_index, startDate),
    dayIndex: row.day_index,
    d: "",
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

/** Sort by dayIndex ascending and re-pad `d` ordinals. Pure; safe for client-side use after Realtime deltas. */
export function withOrdinals(days: ItineraryDay[]): ItineraryDay[] {
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
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

/** The earliest date the guided planner may write to: today while the trip is
 * running, null otherwise. Null means no floor -- every day is writable. */
export function planFloor(
  today: string,
  startDate: string,
  endDate: string,
): string | null {
  return tripActive(today, startDate, endDate) ? today : null
}

/** Minimal day shape the floor helpers read; a full `ItineraryDay` is assignable. */
export interface DayDateAndLocation {
  dayDate: string
  locationId: string | null
}

/** The earliest day at or after `floor`, optionally restricted to one location.
 * A null floor means no lower bound. Undefined when no day qualifies. */
export function firstDayAtOrAfter(
  days: DayDateAndLocation[],
  floor: string | null,
  locationId?: string,
): string | undefined {
  let best: string | undefined
  for (const day of days) {
    if (floor && day.dayDate < floor) continue
    if (locationId && day.locationId !== locationId) continue
    if (best === undefined || day.dayDate < best) best = day.dayDate
  }
  return best
}

/** One-line summary for a day: the typed sub, else a cheap hint from the events
 * (the lone event's text, or "N events"), else "". Pure; safe server or client. */
export function daySummary(day: ItineraryDay): string {
  if (day.sub.trim()) return day.sub
  if (day.events.length === 0) return ""
  if (day.events.length === 1) return day.events[0].text
  return `${day.events.length} events`
}

/** Copy of `day` moved to day `dayIndex` with its date and labels recomputed.
 * `d` is untouched; re-pad with `withOrdinals` after reordering. Used for the
 * optimistic reorder update before the server round-trip. */
export function reassignDayIndex(
  day: ItineraryDay,
  dayIndex: number,
  startDate: string | null,
): ItineraryDay {
  return { ...day, dayIndex, ...positionFields(dayIndex, startDate) }
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

/** Reorder a location's days over the given ascending `slotIndexes` (its
 * occupied day numbers, past-filtered on a live trip), then re-lay onto those
 * numbers. Returns only the days whose number changed. Pure; safe client-side
 * for the optimistic update. */
export function reorderRangeSlots(
  days: ItineraryDay[],
  slotIndexes: number[],
  activeId: string,
  overId: string,
): { id: string; dayIndex: number }[] {
  if (activeId === overId) return []
  const idByIndex = new Map(days.map((d) => [d.dayIndex, d.id]))
  const indexById = new Map(days.map((d) => [d.id, d.dayIndex]))
  const ids = slotIndexes
    .map((i) => idByIndex.get(i))
    .filter((id): id is string => Boolean(id))
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return []
  const moved = moveItem(ids, oldIndex, newIndex)
  const changes: { id: string; dayIndex: number }[] = []
  moved.forEach((id, i) => {
    if (indexById.get(id) !== slotIndexes[i]) changes.push({ id, dayIndex: slotIndexes[i] })
  })
  return changes
}
