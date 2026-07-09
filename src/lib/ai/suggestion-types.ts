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
