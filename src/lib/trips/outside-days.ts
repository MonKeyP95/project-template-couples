import { dayIndexOf } from "@/lib/trips/itinerary-types"

/** Current day numbers that stay inside the trip; `last` null = no end. */
export interface KeptRange {
  first: number
  last: number | null
}

/**
 * The current day numbers that still fall inside the trip after its start or
 * length changes. A new start shifts every number by how far it moved (the
 * renumber trigger keeps days on their dates); giving or removing dates moves
 * nothing.
 */
export function keptRange(change: {
  oldStart: string | null
  newStart: string | null
  newLength: number | null
}): KeptRange {
  const shift =
    change.oldStart && change.newStart ? dayIndexOf(change.oldStart, change.newStart) - 1 : 0
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
