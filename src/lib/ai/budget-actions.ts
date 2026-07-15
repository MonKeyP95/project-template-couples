"use server"

import { draftBudgetSeeds, draftBudgetFill, type DraftedBudgetItem } from "@/lib/ai/claude"
import {
  planBudgetSteps,
  type BudgetPlanInput,
  type BudgetStep,
  type SeedItem,
} from "@/lib/ai/budget-planner"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { dayCountInclusive } from "@/lib/trips/budget-history-types"

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

/** A walk line the couple entered; amountEuros null when they left it blank. */
export interface EnteredLine {
  category: string
  place: string
  subject: string
  whenLabel: string
  amountEuros: number | null
}

/** An assembled budget line for the review, marked for what it is. */
export interface FilledBudgetLine {
  category: string
  place: string
  subject: string
  whenLabel: string
  amountCents: number
  estimated: boolean
  sourceUrl: string | null
  priceUnknown: boolean
}

/**
 * Generate's server half: keep every price the couple typed, ask the assistant
 * to price the blanks (bounded web search) and suggest missing lines, and mark
 * each result honestly. Pressing Generate is explicit consent, so it always
 * calls the model. Assembles the review model; does NOT write. Never throws.
 */
export async function draftAndFillBudget(input: {
  tripId: string
  tripSlug: string
  lines: EnteredLine[]
  locations: { name: string; nights: number; dateLabel: string | null }[]
  memberCount: number
}): Promise<{ error?: string; lines?: FilledBudgetLine[] }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip || !trip.startDate) return { error: "Trip not found." }

  const priced = input.lines.filter(
    (l): l is EnteredLine & { amountEuros: number } => l.amountEuros != null,
  )
  const unpriced = input.lines.filter((l) => l.amountEuros == null)

  // Typed prices pass through untouched.
  const out: FilledBudgetLine[] = priced.map((l) => ({
    category: l.category,
    place: l.place,
    subject: l.subject,
    whenLabel: l.whenLabel,
    amountCents: Math.round(l.amountEuros * 100),
    estimated: false,
    sourceUrl: null,
    priceUnknown: false,
  }))

  const unknown = (l: EnteredLine): FilledBudgetLine => ({
    category: l.category,
    place: l.place,
    subject: l.subject,
    whenLabel: l.whenLabel,
    amountCents: 0,
    estimated: false,
    sourceUrl: null,
    priceUnknown: true,
  })

  try {
    const { profileBlock, tasteDirective } = await buildAssistantContext(
      workspace.id,
      trip.id,
    )
    const prefs = await getDiningPreferences(workspace.id)

    const fill = await draftBudgetFill({
      destination: trip.country ?? trip.name,
      tripDays: dayCountInclusive(trip.startDate, trip.endDate ?? trip.startDate),
      memberCount: input.memberCount,
      budgetBand: prefs.budgetBand,
      profileBlock,
      tasteDirective,
      locations: input.locations,
      priced: priced.map((l) => ({
        category: l.category,
        place: l.place,
        subject: l.subject,
        whenLabel: l.whenLabel,
        amountEuros: l.amountEuros,
      })),
      unpriced: unpriced.map((l) => ({
        category: l.category,
        place: l.place,
        subject: l.subject,
        whenLabel: l.whenLabel,
      })),
    })

    // Couldn't reach the assistant: keep typed prices, flag the blanks unknown.
    if (!fill) {
      for (const u of unpriced) out.push(unknown(u))
      return { lines: out }
    }

    unpriced.forEach((u, i) => {
      const price = fill.fills[i]
      if (price == null) {
        out.push(unknown(u))
        return
      }
      out.push({
        category: u.category,
        place: u.place,
        subject: u.subject,
        whenLabel: u.whenLabel,
        amountCents: Math.round(price * 100),
        estimated: true,
        sourceUrl: fill.fillSources[i],
        priceUnknown: false,
      })
    })

    for (const a of fill.additions) {
      out.push({
        category: a.category,
        place: a.place,
        subject: a.subject,
        whenLabel: a.whenLabel,
        amountCents: a.amountEuros == null ? 0 : Math.round(a.amountEuros * 100),
        estimated: a.amountEuros != null,
        sourceUrl: a.sourceUrl,
        priceUnknown: a.amountEuros == null,
      })
    }

    return { lines: out }
  } catch {
    for (const u of unpriced) out.push(unknown(u))
    return { lines: out }
  }
}
