// Shapes for the restaurant discovery agent. Pure types — no server-only, no
// SDK import — so a client component can import RestaurantSuggestion to render
// results (the *-types.ts split rule).

/** What we ask Claude to find — a trip's facts plus the couple's tastes. */
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
