"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { generateDispatch, proposeRoadSuggestion } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripExpenseCategories } from "@/lib/trips/expense-queries"
import { daySummary } from "@/lib/trips/itinerary-types"
import type { DispatchItem } from "@/lib/trips/dispatch-types"
import { getDispatchForDay } from "./dispatch-queries"
import {
  getAnsweredSuggestions,
  getSuggestionForDay,
} from "./road-suggestion-queries"

/**
 * Generate today's dispatch and today's suggestion once each, if missing.
 * Called after paint from the client so the page never waits on a web-search
 * turn. Each half is written even when it is empty — that is what stops a quiet
 * day re-searching on every load.
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

  const dispatch = await getDispatchForDay(trip.id, dayDate)
  const suggestion = await getSuggestionForDay(trip.id, dayDate)
  if (dispatch && suggestion) return

  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? trip.name
  const todayPlan = day
    ? [day.title, daySummary(day)].filter(Boolean).join(" - ")
    : ""

  const context = await buildAssistantContext(workspace.id, trip.id)
  const supabase = await createClient()

  // The dispatch half owns the only web search. When its row already exists the
  // search is skipped and its stored items still feed the suggestion.
  let items: DispatchItem[] = dispatch?.items ?? []
  if (!dispatch) {
    items = await generateDispatch({
      place,
      dayDate,
      profileBlock: context.profileBlock,
      tasteDirective: context.tasteDirective,
      todayPlan,
    })
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
  }

  if (!suggestion) {
    const answered = await getAnsweredSuggestions(trip.id)
    const categories = await getTripExpenseCategories(trip.id)
    const proposal = await proposeRoadSuggestion({
      place,
      dayDate,
      profileBlock: context.profileBlock,
      tasteDirective: context.tasteDirective,
      todayPlan,
      dispatchItems: items,
      added: answered.filter((a) => a.outcome === "added").map((a) => a.title),
      refused: answered
        .filter((a) => a.outcome === "dismissed")
        .map((a) => a.title),
      categories: categories.map((c) => c.name),
    })
    // No proposal still writes a row, so a quiet day is asked once, not once
    // per page load. answered_at stays null: nobody answered it.
    const { error } = await supabase.from("trip_suggestions").upsert(
      {
        trip_id: trip.id,
        day_date: dayDate,
        title: proposal?.title ?? "",
        body: proposal?.body ?? "",
        target: "event",
        category: proposal?.category ?? "",
        suggested_time: proposal?.suggestedTime ?? "",
        source_url: proposal?.sourceUrl ?? "",
        outcome: proposal ? "pending" : "dismissed",
      },
      { onConflict: "trip_id,day_date" },
    )
    if (error) throw new Error(error.message)
  }

  revalidatePath("/on-the-road")
}
