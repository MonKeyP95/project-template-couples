"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { generateDispatch, generateDispatchDetail } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { daySummary } from "@/lib/trips/itinerary-types"
import type { DispatchDetail } from "@/lib/trips/dispatch-types"
import { getDispatchForDay } from "./dispatch-queries"

/** Where the couple is that day and what they had planned. Shared by the
 * dispatch and by the detail behind one of its cards, so the two agree. */
async function dayContext(
  trip: { id: string; name: string; country: string | null },
  dayDate: string,
): Promise<{ place: string; todayPlan: string }> {
  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  return {
    place: locationName ?? trip.country ?? trip.name,
    todayPlan: day
      ? [day.title, daySummary(day)].filter(Boolean).join(" - ")
      : "",
  }
}

/**
 * Generate today's dispatch once, if missing. Called after paint from the
 * client so the page never waits on a web-search turn. The row is written even
 * when it is empty — that is what stops a quiet day re-searching on every load.
 */
export async function ensureDispatch(
  tripSlug: string,
  dayDate: string,
): Promise<void> {
  if (!(await isAiEnabled())) return

  const workspace = await getCurrentWorkspace()
  if (!workspace) return
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return

  if (await getDispatchForDay(trip.id, dayDate)) return

  const { place, todayPlan } = await dayContext(trip, dayDate)

  const context = await buildAssistantContext(workspace.id, trip.id)
  const items = await generateDispatch({
    place,
    dayDate,
    profileBlock: context.profileBlock,
    tasteDirective: context.tasteDirective,
    todayPlan,
  })

  const supabase = await createClient()
  const { error } = await supabase.from("trip_dispatch").upsert(
    {
      trip_id: trip.id,
      day_date: dayDate,
      items,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,day_date" },
  )
  if (error) throw new Error(error.message)

  revalidatePath("/on-the-road")
}

/**
 * More on one card in today's dispatch, optionally answering the couple's own
 * question. The item is read from the stored row by index — the client's copy
 * is never trusted as prompt input. Reads only: nothing is written, nothing is
 * revalidated, nothing is cached.
 */
export async function learnAboutItem(
  tripSlug: string,
  dayDate: string,
  itemIndex: number,
  question: string,
): Promise<{ detail?: DispatchDetail; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return { error: "No trip in context." }

  const dispatch = await getDispatchForDay(trip.id, dayDate)
  const item = dispatch?.items[itemIndex]
  if (!item) return { error: "That card is no longer here." }

  try {
    const { place } = await dayContext(trip, dayDate)
    const detail = await generateDispatchDetail({
      place,
      dayDate,
      item,
      question: question.trim(),
    })
    return { detail }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
