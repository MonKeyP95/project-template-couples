import { reorderRangeSlots, type ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Drop-target id prefix for an empty day position. */
export const EMPTY_PREFIX = "empty:"

/** The trip's length in days: its day count, or its last planned day if later
 * (or when an older dream never set a count). */
export function tripLength(days: { dayIndex: number }[], dayCount: number | null): number {
  return Math.max(dayCount ?? 0, ...days.map((d) => d.dayIndex))
}

/** Day positions 1..length with nothing planned, ascending. */
export function emptyPositions(days: { dayIndex: number }[], length: number): number[] {
  const taken = new Set(days.map((d) => d.dayIndex))
  const out: number[] = []
  for (let i = 1; i <= length; i++) if (!taken.has(i)) out.push(i)
  return out
}

/** The location day `i` belongs to: the one whose declared span covers it,
 * else the one whose days run around it, else none (a travel day). */
export function positionOwner(
  i: number,
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): string | null {
  const spanned = locations.find(
    (l) => l.startIndex !== null && l.endIndex !== null && l.startIndex <= i && i <= l.endIndex,
  )
  if (spanned) return spanned.id
  for (const l of locations) {
    if (l.startIndex !== null) continue
    const own = days.filter((d) => d.locationId === l.id).map((d) => d.dayIndex)
    if (own.length > 0 && Math.min(...own) <= i && i <= Math.max(...own)) return l.id
  }
  return null
}

export type DropPlan =
  | { kind: "none" }
  | { kind: "reorder"; changes: { id: string; dayIndex: number }[] }
  | { kind: "move"; dayId: string; dayIndex: number; locationId: string | null; keepGroup: boolean }

/**
 * What dropping day `activeId` on `overId` does. On an empty position: move
 * there and take that position's location, keeping its block only when it
 * lands next to another of the block's days. On a planned day of the same
 * location: reorder as before. Anything else, or a target before `floor`
 * (today on a live trip): nothing.
 */
export function planDrop(input: {
  days: ItineraryDay[]
  locations: ItineraryLocation[]
  activeId: string
  overId: string
  floor: number | null
}): DropPlan {
  const { days, locations, activeId, overId, floor } = input
  const active = days.find((d) => d.id === activeId)
  if (!active || activeId === overId) return { kind: "none" }

  if (overId.startsWith(EMPTY_PREFIX)) {
    const dayIndex = Number(overId.slice(EMPTY_PREFIX.length))
    if (floor !== null && dayIndex < floor) return { kind: "none" }
    const keepGroup =
      active.groupId !== null &&
      days.some(
        (d) =>
          d.id !== active.id &&
          d.groupId === active.groupId &&
          Math.abs(d.dayIndex - dayIndex) === 1,
      )
    return {
      kind: "move",
      dayId: active.id,
      dayIndex,
      locationId: positionOwner(dayIndex, locations, days),
      keepGroup,
    }
  }

  const over = days.find((d) => d.id === overId)
  if (!over || over.locationId !== active.locationId) return { kind: "none" }
  const same = days.filter((d) => d.locationId === active.locationId)
  const slotIndexes = same
    .map((d) => d.dayIndex)
    .sort((a, b) => a - b)
    .filter((i) => floor === null || i >= floor)
  const changes = reorderRangeSlots(same, slotIndexes, activeId, overId)
  return changes.length > 0 ? { kind: "reorder", changes } : { kind: "none" }
}
