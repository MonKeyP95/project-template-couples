"use server"

import { draftBudgetSeeds, type DraftedBudgetItem } from "@/lib/ai/claude"
import {
  planBudgetSteps,
  type BudgetPlanInput,
  type BudgetStep,
  type SeedItem,
} from "@/lib/ai/budget-planner"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

/** Category label -> step key, matching budget-planner's step keys. */
const STEP_KEY_BY_CATEGORY: Record<string, string> = {
  Accommodation: "accommodation",
  Transportation: "transport",
  Food: "food",
  Activities: "activities",
  Other: "other",
}

function toSeed(item: DraftedBudgetItem): SeedItem {
  return {
    subject: item.subject,
    when: item.whenLabel,
    suggestedCents: Math.round(Math.max(0, item.amountEuros) * 100),
  }
}

/** Category keys whose steps are per-location; the rest are trip-wide. */
const PER_LOCATION = new Set(["accommodation", "food", "activities"])

/** Overlay Claude's items onto the deterministic scaffold. Each step is one
 * (category, place); a step that receives >= 1 item has its seed replaced, one
 * with none keeps its mock seed. A per-location item is matched to its step by
 * category + place name (case-insensitive); trip-wide items ignore place.
 * Unmatched items are dropped. */
function mergeSeeds(steps: BudgetStep[], items: DraftedBudgetItem[]): BudgetStep[] {
  // (catKey, placeLower) -> the step's bucket key. Trip-wide steps key on "".
  const bucketByCatPlace = new Map<string, string>()
  for (const step of steps) {
    const catKey = step.key.split(":")[0]
    const placeLower = step.place ? step.place.trim().toLowerCase() : ""
    bucketByCatPlace.set(`${catKey}::${placeLower}`, step.key)
  }

  const byBucket = new Map<string, SeedItem[]>()
  for (const item of items) {
    const catKey = STEP_KEY_BY_CATEGORY[item.category]
    if (!catKey) continue
    const placeLower = PER_LOCATION.has(catKey) ? item.place.trim().toLowerCase() : ""
    const bucketKey = bucketByCatPlace.get(`${catKey}::${placeLower}`)
    if (!bucketKey) continue
    const rows = byBucket.get(bucketKey) ?? []
    rows.push(toSeed(item))
    byBucket.set(bucketKey, rows)
  }

  return steps.map((step) => {
    const rows = byBucket.get(step.key)
    return rows && rows.length ? { ...step, seed: rows } : step
  })
}

/** Build the deterministic interview scaffold, then overlay a real Claude draft.
 * On any failure returns the scaffold unchanged with drafted:false, so the
 * interview always opens. Suggest-only: reads context, writes nothing. */
export async function draftBudget(
  input: BudgetPlanInput & { tripSlug: string },
): Promise<{ steps: BudgetStep[]; drafted: boolean }> {
  const { tripSlug, ...planInput } = input
  const scaffold = planBudgetSteps(planInput)

  try {
    const workspace = await getCurrentWorkspace()
    if (!workspace) return { steps: scaffold, drafted: false }
    const trip = await getTripBySlug(workspace.id, tripSlug)
    if (!trip) return { steps: scaffold, drafted: false }
    const prefs = await getDiningPreferences(workspace.id)

    const items = await draftBudgetSeeds({
      destination: trip.country ?? planInput.tripName,
      tripDays: planInput.totalDays,
      memberCount: planInput.memberCount,
      locations: planInput.locations.map((l) => ({
        name: l.name,
        nights: l.nights,
        dateLabel: l.dateLabel,
      })),
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      budgetBand: prefs.budgetBand,
    })

    if (items.length === 0) return { steps: scaffold, drafted: false }
    return { steps: mergeSeeds(scaffold, items), drafted: true }
  } catch {
    return { steps: scaffold, drafted: false }
  }
}
