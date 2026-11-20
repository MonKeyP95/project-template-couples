import type { BudgetStep } from "@/lib/ai/budget-planner"

/**
 * The drafter's steps as data: the fixed walk from planBudgetSteps plus one
 * step per (category, scope) that saved lines use and no fixed step covers.
 * Scope follows "trips first, places secondary": under 2 places everything is
 * the trip (null); from 2 places a line's scope is its place, null = trip-wide.
 */

export const CATEGORY_BY_STEP: Record<string, string> = {
  accommodation: "Accommodation",
  transport: "Transportation",
  food: "Food",
  groceries: "Groceries",
  activities: "Activities",
  other: "Other",
}

export interface StepPlace {
  id: string
  name: string
}

export interface DraftStep extends BudgetStep {
  category: string
  /** The place new rows in this step get; null = trip-wide. */
  locationId: string | null
}

export function isMultiPlace(places: StepPlace[]): boolean {
  return places.length >= 2
}

export function scopeOf(locationId: string | null, places: StepPlace[]): string | null {
  if (!isMultiPlace(places) || !locationId) return null
  return places.some((p) => p.id === locationId) ? locationId : null
}

export function fromPlannedStep(step: BudgetStep, places: StepPlace[]): DraftStep {
  const [catKey, locKey] = step.key.split(":")
  const multi = isMultiPlace(places)
  return {
    ...step,
    category: CATEGORY_BY_STEP[catKey],
    locationId: locKey && locKey !== "trip" ? locKey : null,
    place: multi ? step.place : null,
    placeWhen: multi ? step.placeWhen : null,
  }
}

export function extraStep(
  category: string,
  locationId: string | null,
  places: StepPlace[],
): DraftStep {
  const scope = scopeOf(locationId, places)
  return {
    key: `extra:${scope ?? "trip"}:${category}`,
    title: category,
    question: `Anything in ${category}?`,
    hint: null,
    addNoun: category.toLowerCase(),
    seed: [],
    place: scope ? (places.find((p) => p.id === scope)?.name ?? null) : null,
    placeWhen: null,
    category,
    locationId,
  }
}

export function stepFor(
  steps: DraftStep[],
  category: string,
  locationId: string | null,
  places: StepPlace[],
): DraftStep | undefined {
  const scope = scopeOf(locationId, places)
  return steps.find(
    (s) => s.category === category && scopeOf(s.locationId, places) === scope,
  )
}

/** After the last step with the same scope; appended when there is none. */
export function insertStep(
  steps: DraftStep[],
  step: DraftStep,
  places: StepPlace[],
): DraftStep[] {
  const scope = scopeOf(step.locationId, places)
  let at = -1
  steps.forEach((s, i) => {
    if (scopeOf(s.locationId, places) === scope) at = i
  })
  if (at < 0) return [...steps, step]
  return [...steps.slice(0, at + 1), step, ...steps.slice(at + 1)]
}

export function withLineSteps(
  steps: DraftStep[],
  lines: { category: string; locationId: string | null }[],
  places: StepPlace[],
): DraftStep[] {
  let out = steps
  for (const l of lines) {
    if (!stepFor(out, l.category, l.locationId, places)) {
      out = insertStep(out, extraStep(l.category, l.locationId, places), places)
    }
  }
  return out
}
