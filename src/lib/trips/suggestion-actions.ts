"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getRates } from "@/lib/fx/get-rates"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { payBudgetItem } from "./actions"
import {
  costCents,
  mockOptions,
  optionsToJson,
  rowToSuggestion,
  type SuggestionOption,
  type TripSuggestionRow,
} from "./suggestion-types"

/** A suggestion's options, filled the first time the card is opened and
 * stored, so a second open reuses them. Piece B fills them from the mock. */
export async function loadSuggestionOptions(
  id: string,
  tripSlug: string,
): Promise<{ options?: SuggestionOption[]; error?: string }> {
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("trip_suggestions")
    .select(
      "id, kind, category, title, location_id, day_index, why, options, itinerary_locations(name), trips(currency)",
    )
    .eq("id", id)
    .maybeSingle<
      TripSuggestionRow & {
        itinerary_locations: { name: string } | null
        trips: { currency: string }
      }
    >()
  if (error) return { error: error.message }
  if (!row) return { error: "That suggestion is gone." }
  const suggestion = rowToSuggestion(row)
  if (suggestion.options) return { options: suggestion.options }

  const options = mockOptions(
    suggestion.kind,
    suggestion.title,
    row.itinerary_locations?.name ?? "",
    row.trips.currency,
  )
  const { error: updErr } = await supabase
    .from("trip_suggestions")
    .update({ options: optionsToJson(options) })
    .eq("id", id)
  if (updErr) return { error: updErr.message }
  revalidatePath(`/trips/${tripSlug}`)
  return { options }
}

/** Removes a suggestion: Dismiss, or after its event was saved. */
export async function deleteSuggestion(id: string, tripSlug: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from("trip_suggestions").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

/**
 * The picked option's price as one planned cost (an estimate, linked to its
 * source), converted to the trip's home currency at today's rate like any
 * expense. `paid` also logs the expense through the normal mark-paid path.
 * No price, nothing written.
 */
export async function addSuggestionCost(input: {
  tripId: string
  tripSlug: string
  category: string
  subject: string
  option: SuggestionOption
  locationId: string | null
  dayDate: string | null
  paid: boolean
}): Promise<{ error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const supabase = await createClient()

  const { count, error: countErr } = await supabase
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
  if (countErr) return { error: countErr.message }
  const local = costCents(input.option, count ?? 1)
  if (local === null) return {}
  const amount = await toTripHome(input.tripId, input.option.currency, local)
  if (typeof amount !== "number") return amount

  const { data: last } = await supabase
    .from("trip_budget_items")
    .select("sort_order")
    .eq("trip_id", input.tripId)
    .eq("category", input.category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: item, error: insErr } = await supabase
    .from("trip_budget_items")
    .insert({
      trip_id: input.tripId,
      category: input.category,
      subject: input.subject,
      amount_cents: amount,
      location_id: input.locationId,
      estimated: true,
      source_url: input.option.url,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single()
  if (insErr) return { error: insErr.message }

  // The trip's planned total is left alone: it may be the couple's own
  // estimate with no lines behind it, and one restaurant must not replace it.
  if (input.paid) return await payBudgetItem(item.id, input.tripSlug, input.dayDate)
  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/** Cents in `currency` -> the trip's home currency, at today's rate. */
async function toTripHome(
  tripId: string,
  currency: string,
  cents: number,
): Promise<number | { error: string }> {
  const supabase = await createClient()
  const { data: trip } = await supabase
    .from("trips")
    .select("home_currency")
    .eq("id", tripId)
    .maybeSingle()
  if (!trip) return { error: "Trip not found." }
  if (currency === trip.home_currency) return cents
  const foreignPerHome = (await getRates(trip.home_currency))?.[currency]
  if (!foreignPerHome) return { error: "No rate available for that currency right now." }
  return toHomeCents(cents, inverseRate(foreignPerHome))
}
