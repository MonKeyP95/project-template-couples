import type { ItineraryEvent, ItineraryTone } from "@/lib/trips/itinerary-types"

export interface SharedLocation {
  name: string
  sortOrder: number
}

export interface SharedDay {
  /** 1-based position; the public view renders this as "Day 1". */
  ordinal: number
  title: string
  tag: string
  tone: ItineraryTone
  /** Location this day sits under; null = a travel/unfiled day. */
  locationName: string | null
  events: ItineraryEvent[]
}

export interface SharedTrip {
  name: string
  country: string | null
  dayCount: number
  locations: SharedLocation[]
  days: SharedDay[]
}

function parseEvents(raw: unknown): ItineraryEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      ...(typeof e.endTime === "string" && e.endTime.length > 0
        ? { endTime: e.endTime }
        : {}),
      text: typeof e.text === "string" ? e.text : "",
    }))
    .filter((e) => e.text.length > 0)
}

/** Shape the raw json from `shared_trip()` into a SharedTrip. Returns null when
 * the RPC returned null (unknown token / not public). Tolerates missing arrays. */
export function jsonToSharedTrip(raw: unknown): SharedTrip | null {
  if (raw === null || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== "string") return null

  const locations: SharedLocation[] = Array.isArray(o.locations)
    ? o.locations
        .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
        .map((l) => ({
          name: typeof l.name === "string" ? l.name : "",
          sortOrder: typeof l.sort_order === "number" ? l.sort_order : 0,
        }))
    : []

  const days: SharedDay[] = Array.isArray(o.days)
    ? o.days
        .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
        .map((d) => ({
          ordinal: typeof d.ordinal === "number" ? d.ordinal : 0,
          title: typeof d.title === "string" ? d.title : "",
          tag: typeof d.tag === "string" ? d.tag : "",
          tone: (typeof d.tone === "string" ? d.tone : "sand") as ItineraryTone,
          locationName: typeof d.location_name === "string" ? d.location_name : null,
          events: parseEvents(d.events),
        }))
    : []

  return {
    name: o.name,
    country: typeof o.country === "string" ? o.country : null,
    dayCount: typeof o.day_count === "number" ? o.day_count : days.length,
    locations,
    days,
  }
}
