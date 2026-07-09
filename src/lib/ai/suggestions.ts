/**
 * Mock for AI suggestions. Superseded by suggestion-actions.ts + claude.ts;
 * kept only until the client stops importing it (deleted in Task 4).
 */

import type { SurfaceKey, Suggestion } from "./suggestion-types"

export type { SurfaceKey, Suggestion }

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
