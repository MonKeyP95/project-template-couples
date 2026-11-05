"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
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
    .select("id, kind, category, title, location_id, day_index, why, options, itinerary_locations(name)")
    .eq("id", id)
    .maybeSingle<TripSuggestionRow & { itinerary_locations: { name: string } | null }>()
  if (error) return { error: error.message }
  if (!row) return { error: "That suggestion is gone." }
  const suggestion = rowToSuggestion(row)
  if (suggestion.options) return { options: suggestion.options }

  const options = mockOptions(suggestion.kind, suggestion.title, row.itinerary_locations?.name ?? "")
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
 * source), then the trip's planned total recomputed. `paid` also logs the
 * expense through the normal mark-paid path. No price, nothing written.
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
  const amount = costCents(input.option, count ?? 1)
  if (amount === null) return {}

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

  const { data: allRows } = await supabase
    .from("trip_budget_items")
    .select("amount_cents")
    .eq("trip_id", input.tripId)
  const total = (allRows ?? []).reduce((sum, r) => sum + (r.amount_cents as number), 0)
  const { error: budErr } = await supabase
    .from("trips")
    .update({ planned_budget_cents: total })
    .eq("id", input.tripId)
  if (budErr) return { error: budErr.message }

  if (input.paid) return await payBudgetItem(item.id, input.tripSlug, input.dayDate)
  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
