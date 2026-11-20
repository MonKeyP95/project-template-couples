export interface TripProfile {
  idea: string
  /** Free text: what they would rather not do. A hard constraint for the assistant. */
  avoid: string
  /** Free text from the new trip flow: where they will sleep. */
  stay: string
  /** Free text: how they will get around. */
  move: string
  /** Free text: what they will do. */
  acts: string
  /** Free text: groceries or eating out. */
  food: string
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  idea: "",
  avoid: "",
  stay: "",
  move: "",
  acts: "",
  food: "",
}

/** Tolerant parse of the jsonb `trip_profile` column; never throws on
 * legacy/malformed data. Legacy trips: `idea` falls back to the old `headline`
 * then `brief` so their text is not lost. Retired keys (vibe, transport) are
 * dropped. (Categories are their own expense_categories rows, not stored here.) */
export function parseTripProfile(raw: unknown): TripProfile {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_TRIP_PROFILE }
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  const legacyHeadline = str(r.headline)
  const legacyBrief = str(r.brief)
  const idea =
    typeof r.idea === "string" && r.idea.trim()
      ? r.idea
      : legacyHeadline || legacyBrief
  return {
    idea,
    avoid: str(r.avoid),
    stay: str(r.stay),
    move: str(r.move),
    acts: str(r.acts),
    food: str(r.food),
  }
}

/** The profile as it is written: trimmed and capped. */
export function cleanTripProfile(p: TripProfile): TripProfile {
  const text = (s: string) => s.trim().slice(0, 500)
  return {
    idea: p.idea.trim().slice(0, 2000),
    avoid: text(p.avoid),
    stay: text(p.stay),
    move: text(p.move),
    acts: text(p.acts),
    food: text(p.food),
  }
}
