"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { addTodayEvent } from "./actions"
import type { SuggestionCardData } from "./road-suggestion-types"

/** Record how a suggestion was answered. RLS gates the write to workspace
 * members, the same way every other trip write is gated. */
async function answer(
  id: string,
  outcome: "added" | "dismissed",
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_suggestions")
    .update({ outcome, answered_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/on-the-road")
  return {}
}

/**
 * Take today's suggestion: write it onto today's day through the same action
 * the find door commits through, then record that they took it. The outcome is
 * written only after the event lands — it must never claim an add that did not
 * happen.
 */
export async function addSuggestion(
  data: SuggestionCardData,
): Promise<{ error?: string }> {
  const result = await addTodayEvent({
    tripId: data.tripId,
    tripSlug: data.tripSlug,
    dayDate: data.dayDate,
    dayId: data.dayId,
    time: data.suggestedTime,
    text: data.title,
    url: data.sourceUrl,
    category: data.category,
  })
  if (result.error) return result
  return answer(data.id, "added")
}

/** Refuse today's suggestion. Writes nothing to the trip. */
export async function dismissSuggestion(
  id: string,
): Promise<{ error?: string }> {
  return answer(id, "dismissed")
}
