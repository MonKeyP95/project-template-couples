import { dayIndexOf } from "@/lib/trips/itinerary-types"

/** Current day numbers that stay inside the trip; `last` null = no end. */
export interface KeptRange {
  first: number
  last: number | null
}

/** Days to add to every day number so days keep their dates when the start
 * moves from `oldStart` to `newStart` (what `shift_trip_days` is given). */
export function startShift(oldStart: string, newStart: string): number {
  return dayIndexOf(oldStart, newStart) - 1
}

/**
 * The current day numbers that still fall inside the trip after its start or
 * length changes. With `keepDates` a new start shifts every number by how far
 * it moved; moving the plan, giving or removing dates shifts nothing.
 */
export function keptRange(change: {
  oldStart: string | null
  newStart: string | null
  newLength: number | null
  keepDates: boolean
}): KeptRange {
  const shift =
    change.keepDates && change.oldStart && change.newStart
      ? startShift(change.oldStart, change.newStart)
      : 0
  return {
    first: 1 - shift,
    last: change.newLength === null ? null : change.newLength - shift,
  }
}

/** True when a day has anything worth asking about: a title, a sub or events.
 * Same rule as the SQL `itinerary_day_is_planned`. */
export function isPlannedRow(row: { title: string | null; sub: string | null; events: unknown }): boolean {
  return (
    (row.title ?? "").trim() !== "" ||
    (row.sub ?? "").trim() !== "" ||
    (Array.isArray(row.events) && row.events.length > 0)
  )
}

export function isOutside(dayIndex: number, range: KeptRange): boolean {
  return dayIndex < range.first || (range.last !== null && dayIndex > range.last)
}
