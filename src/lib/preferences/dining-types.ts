export const BUDGET_BANDS = ["any", "budget", "mid", "splurge"] as const
export type BudgetBand = (typeof BUDGET_BANDS)[number]

export interface DiningPreferences {
  budgetBand: BudgetBand
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
  activities: string[]
}

export const EMPTY_DINING_PREFERENCES: DiningPreferences = {
  budgetBand: "any",
  vibeTags: [],
  dietary: [],
  cuisines: [],
  activities: [],
}

/** Comma-separated free text -> trimmed, de-duped, length-capped list. */
export function parsePreferenceList(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const v = part.trim().slice(0, 40)
    if (v) seen.add(v)
  }
  return Array.from(seen).slice(0, 12)
}

/** Coerces an arbitrary string to a known band, defaulting to "any". */
export function normalizeBudgetBand(raw: string): BudgetBand {
  return (BUDGET_BANDS as readonly string[]).includes(raw)
    ? (raw as BudgetBand)
    : "any"
}
