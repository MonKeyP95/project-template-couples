/**
 * Mock for AI suggestions. Pure, no network. The seam where a real model lands
 * later: keep SurfaceKey/Suggestion stable, then make suggestionFor async and
 * generate from the LLM client. `context` is reserved for trip facts; the mock
 * ignores it. Content here is a deterministic placeholder, easy to swap.
 */

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

const SUGGESTIONS: Record<SurfaceKey, Suggestion> = {
  budget: {
    label: "/ suggested",
    body: "Street food keeps daily costs low in much of Southeast Asia — you could trim the food estimate and pad activities.",
  },
  packing: {
    label: "/ suggested",
    body: "Crater nights get cold even in the tropics — a packable warm layer is easy to forget.",
  },
  itinerary: {
    label: "/ assistant",
    body: "Popular treks and permits sell out in peak season — worth booking the big-ticket days early.",
  },
  notes: {
    label: "/ suggested",
    body: "Jot your guesthouse check-in time and any booking references here so they're handy once you're on the road.",
  },
  home: {
    label: "/ assistant",
    body: "Your next trip is coming up — a good moment to start the packing list together.",
  },
  road: {
    label: "/ assistant",
    body: "Log expenses as you spend today so the settle-up stays honest and there's nothing to reconstruct later.",
  },
  checklists: {
    label: "/ suggested",
    body: "Duplicate a past list as a starting point instead of building a new one from scratch.",
  },
}

export function suggestionFor(
  surface: SurfaceKey,
  context?: string,
): Suggestion | null {
  void context
  return SUGGESTIONS[surface] ?? null
}
