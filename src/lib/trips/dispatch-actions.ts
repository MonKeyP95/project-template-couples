"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { generateDispatch } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { daySummary } from "@/lib/trips/itinerary-types"
import { getDispatchForDay } from "./dispatch-queries"

/**
 * Generate today's dispatch once, if it does not exist yet. Called after paint
 * from the client so the page never waits on a web-search turn. A row with zero
 * items still gets written — that is what stops a quiet day re-searching on
 * every load.
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

  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? trip.name

  const context = await buildAssistantContext(workspace.id, trip.id)
  const items = await generateDispatch({
    place,
    dayDate,
    profileBlock: context.profileBlock,
    tasteDirective: context.tasteDirective,
    todayPlan: day
      ? [day.title, daySummary(day)].filter(Boolean).join(" - ")
      : "",
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
