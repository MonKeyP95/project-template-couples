import { reorderRangeSlots, type ItineraryDay } from "@/lib/trips/itinerary-types"
import { isPlannedRow } from "@/lib/trips/outside-days"

/** True when `day`'s block, with `day` moved to `dayIndex`, is still one
 * unbroken run of days. Otherwise the moved day leaves the block. */
function staysOneRun(days: ItineraryDay[], day: ItineraryDay, dayIndex: number): boolean {
  if (day.groupId === null) return false
  const others = days
    .filter((d) => d.id !== day.id && d.groupId === day.groupId)
    .map((d) => d.dayIndex)
  if (others.length === 0) return false
  const run = [...others, dayIndex]
  return Math.max(...run) - Math.min(...run) + 1 === run.length
}

/** A run of consecutive days: one multi-day block, or a single day. */
export interface DaySegment {
  groupId: string | null
  days: ItineraryDay[]
}

/** Collapse day-sorted days into runs of same-block days with no gap between
 * them; a block broken by a gap renders as separate runs. */
export function toSegments(days: ItineraryDay[]): DaySegment[] {
  const segments: DaySegment[] = []
  for (const day of days) {
    const last = segments[segments.length - 1]
    const prev = last?.days[last.days.length - 1]
    if (day.groupId && last && last.groupId === day.groupId && prev && day.dayIndex === prev.dayIndex + 1) {
      last.days.push(day)
    } else {
      segments.push({ groupId: day.groupId, days: [day] })
    }
  }
  return segments
}

/** `current` with the days in `ids` put back as they were in `snapshot`;
 * every other day, including a partner's live change, is kept. */
export function restoreDays(
  current: ItineraryDay[],
  snapshot: ItineraryDay[],
  ids: string[],
): ItineraryDay[] {
  const before = new Map(snapshot.map((d) => [d.id, d]))
  const undo = new Set(ids)
  return current.map((d) => (undo.has(d.id) ? (before.get(d.id) ?? d) : d))
}

export type DropPlan =
  | { kind: "none" }
  | { kind: "reorder"; changes: { id: string; dayIndex: number }[] }
  | {
      kind: "move"
      dayId: string
      dayIndex: number
      locationId: string | null
      keepGroup: boolean
      /** The empty day landed on; it takes the moved day's old number. */
      emptyId: string
    }

/**
 * What dropping day `activeId` on `overId` does. On an empty day: move there
 * and take its location, keeping the block only when it lands next to another
 * of the block's days. On a planned day of the same location: reorder the
 * location's planned days. Anything else, an empty day being dragged, or a
 * target before `floor` (today on a live trip): nothing.
 */
export function planDrop(input: {
  days: ItineraryDay[]
  activeId: string
  overId: string
  floor: number | null
}): DropPlan {
  const { days, activeId, overId, floor } = input
  const active = days.find((d) => d.id === activeId)
  const over = days.find((d) => d.id === overId)
  if (!active || !over || activeId === overId || !isPlannedRow(active)) return { kind: "none" }
  // A day that already happened never moves, and nothing moves into the past.
  if (floor !== null && (active.dayIndex < floor || over.dayIndex < floor)) return { kind: "none" }

  if (!isPlannedRow(over)) {
    return {
      kind: "move",
      dayId: active.id,
      dayIndex: over.dayIndex,
      locationId: over.locationId,
      keepGroup: staysOneRun(days, active, over.dayIndex),
      emptyId: over.id,
    }
  }

  if (over.locationId !== active.locationId) return { kind: "none" }
  const same = days.filter((d) => d.locationId === active.locationId && isPlannedRow(d))
  const slotIndexes = same
    .map((d) => d.dayIndex)
    .sort((a, b) => a - b)
    .filter((i) => floor === null || i >= floor)
  const changes = reorderRangeSlots(same, slotIndexes, activeId, overId)
  return changes.length > 0 ? { kind: "reorder", changes } : { kind: "none" }
}
