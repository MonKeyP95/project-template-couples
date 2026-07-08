// Pure helpers for the on-the-road discovery door: which meal is it now. No
// server imports so the client door can use it (client/server split rule).

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
