import { createClient } from "@/lib/supabase/server"
import type { LearnedCategory } from "./couple-summary-types"
import { inferRatingCategory } from "./couple-summary-types"
import type { TasteSignal } from "./couple-summary-types"
import { expenseCategoryToLearned } from "@/lib/ai/discovery-types"
import { parseEvents } from "@/lib/trips/itinerary-types"

export interface CoupleSummary {
  summaryMd: string
  ratingCountAtGeneration: number
}

/** The stored summary for a category, or empty defaults when none. */
export async function getCoupleSummary(
  workspaceId: string,
  category: LearnedCategory,
): Promise<CoupleSummary> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("couple_summaries")
    .select("summary_md, rating_count_at_generation")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .maybeSingle()

  if (!data) return { summaryMd: "", ratingCountAtGeneration: 0 }
  return {
    summaryMd: data.summary_md ?? "",
    ratingCountAtGeneration: data.rating_count_at_generation ?? 0,
  }
}

/** How many ratings the corpus holds for a category. */
export async function countRatings(
  workspaceId: string,
  category: LearnedCategory,
): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from("event_ratings")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("category", category)
  return count ?? 0
}

/** Rated places from the durable corpus (strong signal). */
async function gatherRatingSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .order("created_at", { ascending: true })
  return (data ?? []).map((r) => ({
    text: r.event_text as string,
    kind: "rated" as const,
    rating: r.rating as number,
    note: (r.note as string | null) ?? undefined,
  }))
}

/** Itinerary events the couple added but never rated (weak "we did this" signal).
 * Un-rated is the dedup: a rated event lives in event_ratings instead. Categorised
 * by the same classifier ratings use. */
async function gatherPlannedSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("events, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    for (const e of parseEvents((row as { events: unknown }).events)) {
      if (e.rating !== undefined) continue
      if (inferRatingCategory(e.text) !== category) continue
      signals.push({ text: e.text, kind: "planned" })
    }
  }
  return signals
}

/** Category detail tags (weak intent signal): Food -> sushi, burgers. */
async function gatherWantedSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expense_categories")
    .select("name, details, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    const r = row as { name: string; details: string[] | null }
    if (expenseCategoryToLearned(r.name) !== category) continue
    for (const tag of r.details ?? []) signals.push({ text: tag, kind: "wanted" })
  }
  return signals
}

/** The full corpus for a category: rated + planned + wanted. */
export async function gatherTasteSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted] = await Promise.all([
    gatherRatingSignals(workspaceId, category),
    gatherPlannedSignals(workspaceId, category),
    gatherWantedSignals(workspaceId, category),
  ])
  return [...rated, ...planned, ...wanted]
}

/** How many signals of any kind the corpus holds for a category. Drives the
 * display floor and staleness, replacing the ratings-only countRatings. */
export async function countSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<number> {
  return (await gatherTasteSignals(workspaceId, category)).length
}
