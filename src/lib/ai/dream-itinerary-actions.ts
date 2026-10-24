"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { saveTripProfile } from "@/lib/trips/actions"
import { getDreamItineraryDays } from "@/lib/trips/dream-itinerary-queries"
import type { DreamDay } from "@/lib/trips/dream-itinerary-types"
import { getTripBySlug, type TripHeader } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { draftDreamItinerary } from "@/lib/ai/claude"
import type { PlanEntry } from "@/lib/ai/itinerary-planner"
import {
  buildCards,
  closeGaps,
  entryItems,
  placeItems,
  splitDays,
  type DaySpan,
  type DreamCardDraft,
} from "@/lib/ai/dream-plan"

const MAX_DAYS = 365

export interface DreamPlanInput {
  tripId: string
  tripSlug: string
  places: string[]
  entries: PlanEntry[]
  avoid: string
  /** Sent only when the walk asked "How many days?" (an older dream). */
  dayCount: number | null
}

interface Prepared {
  trip: TripHeader
  cards: DreamDay[]
  dayCount: number
  tripPlace: string
  spans: DaySpan[]
  filled: Set<number>
  userId: string
}

/** Load the dream, write back avoid and a first length (closing gaps so no
 * card visibly moves), and lay its days out across the walk's places. */
async function prepare(input: DreamPlanInput): Promise<Prepared | { error: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip || trip.startDate) return { error: "Trip not found." }
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in." }

  const avoid = input.avoid.trim().slice(0, 500)
  if (avoid !== trip.tripProfile.avoid) {
    await saveTripProfile({
      tripId: trip.id,
      tripSlug: input.tripSlug,
      profile: { ...trip.tripProfile, avoid },
    })
  }

  let cards = await getDreamItineraryDays(trip.id)
  let dayCount = trip.dayCount
  if (dayCount === null && input.dayCount !== null) {
    const n = input.dayCount
    if (!Number.isInteger(n) || n < Math.max(1, cards.length) || n > MAX_DAYS) {
      return { error: `How many days: ${Math.max(1, cards.length)} to ${MAX_DAYS}.` }
    }
    for (const move of closeGaps(cards.map((c) => c.dayIndex))) {
      const { error } = await supabase
        .from("dream_itinerary_days")
        .update({ day_index: move.to })
        .eq("trip_id", trip.id)
        .eq("day_index", move.from)
      if (error) return { error: error.message }
    }
    const { error } = await supabase.from("trips").update({ day_count: n }).eq("id", trip.id)
    if (error) return { error: error.message }
    dayCount = n
    cards = await getDreamItineraryDays(trip.id)
  }
  if (dayCount === null) return { error: "How many days is this trip?" }

  const tripPlace = trip.country ?? trip.name
  return {
    trip,
    cards,
    dayCount,
    tripPlace,
    spans: splitDays(dayCount, input.places, tripPlace),
    filled: new Set(cards.map((c) => c.dayIndex)),
    userId: userData.user.id,
  }
}

async function insertCards(
  p: Prepared,
  tripSlug: string,
  cards: DreamCardDraft[],
): Promise<{ error?: string }> {
  if (cards.length > 0) {
    const supabase = await createClient()
    const { error } = await supabase.from("dream_itinerary_days").insert(
      cards.map((c) => ({
        trip_id: p.trip.id,
        day_index: c.dayIndex,
        title: c.title,
        sub: c.sub,
        tag: c.tag,
        tone: c.tone,
        created_by: p.userId,
      })),
    )
    if (error) return { error: error.message }
  }
  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

/** The walk's "apply" on a dream: what the couple entered, on the days they
 * picked, into empty days only. No model. */
export async function applyDreamPlanEntries(
  input: DreamPlanInput,
): Promise<{ error?: string }> {
  const p = await prepare(input)
  if ("error" in p) return p
  const items = input.entries
    .flatMap((e) => entryItems(e, p.dayCount))
    .filter((i) => i.day > 0)
  return insertCards(p, input.tripSlug, buildCards(items, p.filled, p.tripPlace))
}

function knownPlans(entries: PlanEntry[], cards: DreamDay[]): string[] {
  const fromWalk = entries.map(
    (e) =>
      `${e.subject || e.category}${e.place ? ` in ${e.place}` : ""}${e.when ? ` (${e.when})` : ""} [${e.category}]`,
  )
  const fromDays = cards.map(
    (c) => `Day ${c.dayIndex}: ${c.tag} - ${c.title}${c.sub ? ` - ${c.sub}` : ""}`,
  )
  return [...fromWalk, ...fromDays]
}

function prefsLine(trip: TripHeader): string {
  const p = trip.tripProfile
  return [
    ["sleeping", p.stay],
    ["getting around", p.move],
    ["doing", p.acts],
    ["eating", p.food],
  ]
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`)
    .join("; ")
}

/** The walk's Generate on a dream: the dream planner drafts around the filled
 * days and the couple's answers, written into empty days only. Pressing
 * Generate is the approval, so it ignores the global assistant toggle. */
export async function draftAndApplyDreamItinerary(
  input: DreamPlanInput & { freeText: string },
): Promise<{ error?: string }> {
  const p = await prepare(input)
  if ("error" in p) return p
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  try {
    const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id, p.trip.id)
    const { events, question } = await draftDreamItinerary({
      destination: p.tripPlace,
      dayCount: p.dayCount,
      places: p.spans,
      brief: p.trip.tripProfile.idea,
      prefs: prefsLine(p.trip),
      freeText: input.freeText.trim(),
      avoid: input.avoid.trim(),
      knownPlans: knownPlans(input.entries, p.cards),
      profileBlock,
      tasteDirective,
    })
    if (events.length === 0 && question) return { error: question }
    const items = placeItems(
      events.map((e) => ({ category: e.category, place: e.place, text: e.text, day: e.day })),
      p.spans,
      p.filled,
    )
    return await insertCards(p, input.tripSlug, buildCards(items, p.filled, p.tripPlace))
  } catch {
    return { error: "Couldn't draft right now — try again." }
  }
}
