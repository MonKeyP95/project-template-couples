// Shapes for the discovery agent (any category). Pure types — no server-only, no
// SDK import — so a client component can import DiscoverySuggestion to render
// results (the *-types.ts split rule).

/** Which kind of place we are finding. Food and activity are live; the door may
 * show other categories as inactive. */
export type DiscoveryCategory = "food" | "activity"

/** The expense category an event gets when added from the discovery door.
 * Resolved against the trip's real categories at expense time; falls back to
 * Other when the trip has no category by this name. */
export function mapDiscoveryCategory(category: DiscoveryCategory): string {
  return category === "food" ? "Food" : "Activities"
}

/** What we ask Claude to find — the category, a trip's facts, the couple's
 * tastes, and the in-the-moment inputs (craving + walkable-from-anchor). */
export interface DiscoveryQuery {
  category: DiscoveryCategory
  /** e.g. "Lombok, Indonesia". */
  destination: string
  /** Human label for when, e.g. "dinner tonight". Unused for activity. */
  when: string
  /** One of the dining-preferences bands ("any" | "budget" | "mid" | "splurge"). */
  budgetBand: string
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
  /** Couple activities (slice 2), e.g. "surf, hike, museums". */
  activities: string[]
  /** This-trip layer from the trip profile. */
  trip: { vibe: string[]; brief: string }
  /** In-the-moment "what do you feel like?"; "" when unset. Highest-priority signal. */
  craving: string
  /** Proximity anchor for walkable search; "" when unset. */
  near: string
  /** On-foot hard constraint. */
  walkable: boolean
  /** Learned couple summary markdown from past-trip ratings; "" when none. A
   * strong, evidence-based couple signal. */
  learned: string
}

/** One grounded, cited suggestion. */
export interface DiscoverySuggestion {
  name: string
  /** One sentence on why it fits this couple/trip. */
  why: string
  /** Neighbourhood or area. */
  area: string
  /** Rough cost feel as text (e.g. "mid-range") — never an invented exact price. */
  priceHint: string
  /** A real URL from the web search that backs this suggestion. */
  sourceUrl: string
}
