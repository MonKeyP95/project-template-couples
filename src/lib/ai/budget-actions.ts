"use server"

import { draftBudgetFill } from "@/lib/ai/claude"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { dayCountInclusive } from "@/lib/trips/budget-history-types"

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

    return { lines: out }
  } catch {
    for (const u of unpriced) out.push(unknown(u))
    return { lines: out }
  }
}
