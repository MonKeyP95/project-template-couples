export const TRIP_TRANSPORT = [
  "Own car",
  "Rental car",
  "Public transport",
  "Flights between stops",
  "Taxis & walking",
] as const

export const TRIP_VIBES = [
  "Romantic",
  "Adventurous",
  "Relaxed",
  "Social/lively",
  "Cultural",
  "Off-the-beaten-path",
  "Luxe",
] as const

export interface TripProfile {
  idea: string
  transport: string[]
  vibe: string[]
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  idea: "",
  transport: [],
  vibe: [],
}

/** Tolerant parse of the jsonb `trip_profile` column. Filters transport/vibe to
 * allowed sets; never throws on legacy/malformed data. Legacy trips: `idea`
 * falls back to the old `headline` then `brief` so their text is not lost.
 * (Categories are their own expense_categories rows, not stored here.) */
export function parseTripProfile(raw: unknown): TripProfile {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_TRIP_PROFILE }
  const r = raw as Record<string, unknown>
  const pickArr = (v: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x))
      : []
  const legacyHeadline = typeof r.headline === "string" ? r.headline : ""
  const legacyBrief = typeof r.brief === "string" ? r.brief : ""
  const idea =
    typeof r.idea === "string" && r.idea.trim()
      ? r.idea
      : legacyHeadline || legacyBrief
  return {
    idea,
    transport: pickArr(r.transport, TRIP_TRANSPORT),
    vibe: pickArr(r.vibe, TRIP_VIBES),
  }
}
