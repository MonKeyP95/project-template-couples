// Pure types for the proactive suggestion card. No server-only import, so the
// client card and the server query layer can share them (the *-types.ts split).

/** How a suggestion was answered. Only `pending` renders. */
export type SuggestionOutcome = "pending" | "added" | "dismissed"

/** What a suggestion can be added to. Only `event` exists in this slice. */
export type SuggestionTarget = "event"

/** A stored suggestion row. */
export interface RoadSuggestion {
  id: string
  tripId: string
  dayDate: string
  title: string
  body: string
  target: SuggestionTarget
  /** Expense category for the event it creates, e.g. "Food"; "" when none. */
  category: string
  /** HH:MM, or "" when the thing has no clock. */
  suggestedTime: string
  /** Backing URL when it was built on a dispatch finding; "" otherwise. */
  sourceUrl: string
  outcome: SuggestionOutcome
}

/** What the agent proposes. Null from the agent means "nothing worth saying". */
export interface RoadSuggestionProposal {
  title: string
  body: string
  category: string
  suggestedTime: string
  sourceUrl: string
}

/** Everything the card needs to render and to commit its add. */
export interface SuggestionCardData {
  id: string
  title: string
  body: string
  category: string
  suggestedTime: string
  sourceUrl: string
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
}

/** One answered suggestion, for the history block the agent reads. */
export interface AnsweredSuggestion {
  title: string
  outcome: "added" | "dismissed"
}

/** How many answered suggestions the agent is shown. */
export const SUGGESTION_HISTORY_LIMIT = 10
