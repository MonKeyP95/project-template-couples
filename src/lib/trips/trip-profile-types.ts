export const TRIP_VIBES = [
  "Romantic",
  "Adventurous",
  "Relaxed",
  "Social/lively",
  "Cultural",
  "Off-the-beaten-path",
  "Luxe",
] as const

export const TRIP_WHO = ["Just us", "+ kids", "+ friends", "+ family"] as const

export interface TripProfile {
  headline: string
  vibe: string[]
  who: string
  brief: string
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  headline: "",
  vibe: [],
  who: "",
  brief: "",
}

/** Tolerant parse of the jsonb `trip_profile` column. Vibe/who keep only allowed
 * values; never throws on legacy/malformed data. (Activities are not stored here
 * — the trip's categories are the shared expense_categories, edited via Budget
 * and the Profile tab alike.) */
export function parseTripProfile(raw: unknown): TripProfile {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_TRIP_PROFILE }
  const r = raw as Record<string, unknown>
  const pick = (v: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x))
      : []
  return {
    headline: typeof r.headline === "string" ? r.headline : "",
    vibe: pick(r.vibe, TRIP_VIBES),
    who:
      typeof r.who === "string" && (TRIP_WHO as readonly string[]).includes(r.who)
        ? r.who
        : "",
    brief: typeof r.brief === "string" ? r.brief : "",
  }
}
