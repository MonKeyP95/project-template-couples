// Shapes for the restaurant discovery agent. Pure types — no server-only, no
// SDK import — so a client component can import RestaurantSuggestion to render
// results (the *-types.ts split rule).

/** What we ask Claude to find — a trip's facts, the couple's tastes, and the
 * in-the-moment inputs (craving + walkable-from-anchor). */
export interface RestaurantQuery {
  /** e.g. "Lombok, Indonesia". */
  destination: string
  /** Human label for when, e.g. "tomorrow" or "Fri 4 Jul". */
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
}

/** One grounded, cited restaurant suggestion. */
export interface RestaurantSuggestion {
  name: string
  /** One sentence on why it fits this couple/trip. */
  why: string
  /** Neighbourhood or area. */
  area: string
  /** Rough price feel as text (e.g. "mid-range") — never an invented exact price. */
  priceHint: string
  /** A real URL from the web search that backs this suggestion. */
  sourceUrl: string
}
