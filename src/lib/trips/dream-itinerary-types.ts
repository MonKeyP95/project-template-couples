import { type ItineraryTone } from "@/lib/trips/itinerary-types"

export interface DreamDay {
  /** Row id — needed by edit/delete/reorder UI. */
  id: string
  /** 1-based position. The sort + reorder key (dreams have no dates). */
  dayIndex: number
  /** 1-based ordinal padded to 2 digits ("01", "02"). Derived from sort position. */
  d: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface DreamRow {
  id: string
  day_index: number
  title: string
  sub: string | null
  tag: string
  tone: string
}

/** Single row -> DreamDay. `d` is a placeholder; pass through withDreamOrdinals to set correctly. */
export function rowToDreamDay(row: DreamRow): DreamDay {
  return {
    id: row.id,
    dayIndex: row.day_index,
    d: "",
    title: row.title,
    sub: row.sub ?? "",
    tag: row.tag,
    tone: row.tone as ItineraryTone,
  }
}

/** Sort by dayIndex ascending and re-pad `d` ordinals. `positional` (dreams
 * with a day count) labels each day by its dayIndex instead of its sort
 * position, so gaps stay visible. Pure; safe after Realtime deltas. */
export function withDreamOrdinals(
  days: DreamDay[],
  positional = false,
): DreamDay[] {
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  return sorted.map((day, i) => ({
    ...day,
    d: String(positional ? day.dayIndex : i + 1).padStart(2, "0"),
  }))
}

export type DreamSlot =
  | { kind: "day"; day: DreamDay }
  | { kind: "empty"; dayIndex: number }

/** Positions 1..max(dayCount, last dayIndex): each row in place, gaps empty. */
export function dreamSlots(days: DreamDay[], dayCount: number): DreamSlot[] {
  const byIndex = new Map(days.map((d) => [d.dayIndex, d]))
  const last = Math.max(dayCount, ...days.map((d) => d.dayIndex))
  return Array.from({ length: last }, (_, i) => {
    const day = byIndex.get(i + 1)
    return day ? { kind: "day", day } : { kind: "empty", dayIndex: i + 1 }
  })
}
