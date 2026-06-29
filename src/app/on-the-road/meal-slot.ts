// Pure helpers for the on-the-road discovery door: which meal is it now, and is
// that meal already on today's plan. No server imports so the client door can
// use it (client/server split rule).

export type Meal = "breakfast" | "lunch" | "dinner"

/** Meal slot for the given moment. Device-local via getHours(). */
export function currentMeal(now: Date): Meal {
  const h = now.getHours()
  if (h < 11) return "breakfast"
  if (h < 16) return "lunch"
  return "dinner"
}

export function mealLabel(meal: Meal): "Breakfast" | "Lunch" | "Dinner" {
  return ({ breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" } as const)[
    meal
  ]
}

/** Phrase fed to the search engine's free-text `when`. */
export function mealWhen(meal: Meal): string {
  return {
    breakfast: "breakfast today",
    lunch: "lunch today",
    dinner: "dinner tonight",
  }[meal]
}

/** True if any of today's event titles already names this meal. Fuzzy on
 * purpose: a keyword nudge, not a guarantee. */
export function mealAlreadyPlanned(meal: Meal, eventTexts: string[]): boolean {
  return eventTexts.some((t) => t.toLowerCase().includes(meal))
}
