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

/** Sort by dayIndex ascending and re-pad `d` ordinals. Pure; safe for client-side use after Realtime deltas. */
export function withDreamOrdinals(days: DreamDay[]): DreamDay[] {
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  return sorted.map((day, i) => ({
    ...day,
    d: String(i + 1).padStart(2, "0"),
  }))
}
