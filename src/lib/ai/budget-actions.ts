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

/** Overlay Claude's items onto the deterministic scaffold. A bucket that
 * receives >= 1 item has its seed replaced; a bucket with no items keeps its
 * mock seed. Grouped steps (Accommodation/Activities) match `place` to a group
 * by case-insensitive title; unmatched grouped items are dropped. */
function mergeSeeds(steps: BudgetStep[], items: DraftedBudgetItem[]): BudgetStep[] {
  // stepKey -> (groupTitleLower | "") -> SeedItem[]
  const byBucket = new Map<string, Map<string, SeedItem[]>>()
  for (const item of items) {
    const stepKey = STEP_KEY_BY_CATEGORY[item.category]
    if (!stepKey) continue
    const groupKey = item.place.trim().toLowerCase()
    const stepMap = byBucket.get(stepKey) ?? new Map<string, SeedItem[]>()
    const rows = stepMap.get(groupKey) ?? []
    rows.push(toSeed(item))
    stepMap.set(groupKey, rows)
    byBucket.set(stepKey, stepMap)
  }

  return steps.map((step) => {
    const stepMap = byBucket.get(step.key)
    if (!stepMap) return step
    if (step.groups) {
      const groups = step.groups.map((g) => {
        const rows = stepMap.get(g.title.trim().toLowerCase())
        return rows && rows.length ? { ...g, seed: rows } : g
      })
      return { ...step, groups }
    }
    // Flat step: gather all items for this step regardless of place.
    const rows = Array.from(stepMap.values()).flat()
    return rows.length ? { ...step, seed: rows } : step
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
      brief: trip.tripProfile.brief,
      budgetBand: prefs.budgetBand,
    })

    if (items.length === 0) return { steps: scaffold, drafted: false }
    return { steps: mergeSeeds(scaffold, items), drafted: true }
  } catch {
    return { steps: scaffold, drafted: false }
  }
}
