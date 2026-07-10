// Pure types for AI suggestion cards. No server-only import so the client card,
// the server action, and the claude.ts seam can all share them (the *-types.ts
// split convention).

export type SurfaceKey =
  | "budget"
  | "packing"
  | "itinerary"
  | "notes"
  | "home"
  | "road"
  | "checklists"

export interface Suggestion {
  label: string
  body: string
}

/** How the user aimed the suggestion. `page` = the per-surface default. */
export type SuggestScope =
  | { kind: "page" }
  | { kind: "trip" }
  | { kind: "day"; date: string }
  | { kind: "free"; text: string }

/** A pickable day for the "a specific day" scope. */
export interface SuggestDay {
  /** yyyy-mm-dd. */
  date: string
  /** European-order label, e.g. "FRI 12 Jun". */
  label: string
  isToday: boolean
}
