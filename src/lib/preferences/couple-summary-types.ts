// Pure types + helpers for the learned couple summary (slice 6). No server-only
// import so the profile client component can share the staleness rule and the
// category type (the *-types.ts split rule).

export type LearnedCategory = "food" | "activity" | "accommodation" | "transport"

/** Fraction of new ratings (relative to corpus size) that makes a summary stale.
 * Early ratings each carry more weight: at 5 ratings one more is 20%; at 30 it is
 * 3% and not worth a refresh. */
const STALE_FRACTION = 0.2

/** Default minimum signals before a learned summary is shown (food, activity). */
export const RATING_FLOOR = 3

/** Minimum signals in a category before its learned summary is shown. Accommodation
 * and transport learn from a thinner source (real expenses, no ratings), so they
 * surface at a single signal; food and activity keep the higher floor. */
export function signalFloor(category: LearnedCategory): number {
  return category === "accommodation" || category === "transport" ? 1 : RATING_FLOOR
}

/** Meal words -> food; everything else -> activity. Best-effort tag set when a
 * rating is logged; the summariser still reads the text, so a mis-tag is low
 * stakes. */
const MEAL_WORDS = [
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "cafe",
  "café",
  "coffee",
  "restaurant",
  "eat",
  "food",
  "dining",
  "bar",
  "drinks",
  "snack",
]

export function inferRatingCategory(text: string): LearnedCategory {
  const t = text.toLowerCase()
  return MEAL_WORDS.some((w) => t.includes(w)) ? "food" : "activity"
}

/** Stale when there is no summary yet, or enough new ratings have landed since it
 * was generated. Assumes the caller already applied RATING_FLOOR. */
export function isSummaryStale(
  ratingCount: number,
  countAtGeneration: number,
  hasSummary: boolean,
): boolean {
  if (!hasSummary) return true
  if (ratingCount <= 0) return false
  return (ratingCount - countAtGeneration) / ratingCount >= STALE_FRACTION
}

/** One piece of evidence about the couple's taste in a category. A rating is the
 * strong kind; "planned" (added to an itinerary, not rated) and "wanted" (a
 * category detail tag) are lighter hints. The summariser weights them accordingly. */
export interface TasteSignal {
  text: string
  kind: "rated" | "planned" | "wanted" | "used"
  /** Present only when kind === "rated" (1-5). */
  rating?: number
  /** Free note captured with a rating; absent otherwise. */
  note?: string
}

/** The budget expense-category name whose real expenses feed a learned category,
 * for the two categories that learn from actual spending. Food/Activity return
 * null — they learn from ratings/plans/detail tags, not expenses. */
export function learnedCategoryToExpenseName(
  category: LearnedCategory,
): string | null {
  if (category === "accommodation") return "Accommodation"
  if (category === "transport") return "Transportation"
  return null
}
