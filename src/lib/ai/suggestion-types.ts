// Pure types for AI suggestion cards. No server-only import so the client card,
// the server action, and the claude.ts seam can all share them (the *-types.ts
// split convention).

import type { IdeaPlan } from "@/lib/trips/idea-route"

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

/** A home trip idea, three short directions to ask about next, and the walk
 * answers + route used when it is accepted. */
export interface TripIdea extends Suggestion {
  options: string[]
  plan: IdeaPlan
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
