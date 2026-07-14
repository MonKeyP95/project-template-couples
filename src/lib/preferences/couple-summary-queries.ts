import { createClient } from "@/lib/supabase/server"
import {
  inferRatingCategory,
  learnedCategoryToExpenseName,
  RATING_FLOOR,
  type LearnedCategory,
  type TasteSignal,
} from "./couple-summary-types"
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

/** Real expenses in the category's budget bucket (Accommodation / Transportation)
 * — a "we actually booked this" signal. Reads the title text, never the amount;
 * skips settlement rows. Returns [] for categories that do not learn from
 * expenses (food, activity). */
async function gatherSpentSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const name = learnedCategoryToExpenseName(category)
  if (!name) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select("title, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
    .eq("category", name)
    .eq("is_settlement", false)
  return (data ?? []).map((r) => ({
    text: (r as { title: string }).title,
    kind: "used" as const,
  }))
}

/** The full corpus for a category: rated + planned + wanted + used (used is only
 * non-empty for accommodation/transport). */
export async function gatherTasteSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted, used] = await Promise.all([
    gatherRatingSignals(workspaceId, category),
    gatherPlannedSignals(workspaceId, category),
    gatherWantedSignals(workspaceId, category),
    gatherSpentSignals(workspaceId, category),
  ])
  return [...rated, ...planned, ...wanted, ...used]
}

/** How many signals of any kind the corpus holds for a category. Drives the
 * display floor and staleness, replacing the ratings-only countRatings. */
export async function countSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<number> {
  return (await gatherTasteSignals(workspaceId, category)).length
}

/** Rated places on one trip (strong signal). */
async function gatherTripRatingSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("trip_id", tripId)
    .eq("category", category)
    .order("created_at", { ascending: true })
  return (data ?? []).map((r) => ({
    text: r.event_text as string,
    kind: "rated" as const,
    rating: r.rating as number,
    note: (r.note as string | null) ?? undefined,
  }))
}

/** Un-rated itinerary events on one trip (weak "we did this" signal). */
async function gatherTripPlannedSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("events")
    .eq("trip_id", tripId)
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

/** Category detail tags on one trip (weak intent signal). */
async function gatherTripWantedSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expense_categories")
    .select("name, details")
    .eq("trip_id", tripId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    const r = row as { name: string; details: string[] | null }
    if (expenseCategoryToLearned(r.name) !== category) continue
    for (const tag of r.details ?? []) signals.push({ text: tag, kind: "wanted" })
  }
  return signals
}

/** Real expenses on one trip in the category's budget bucket (title only, no
 * amount; settlements skipped). Empty for food/activity. */
async function gatherTripSpentSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const name = learnedCategoryToExpenseName(category)
  if (!name) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select("title")
    .eq("trip_id", tripId)
    .eq("category", name)
    .eq("is_settlement", false)
  return (data ?? []).map((r) => ({
    text: (r as { title: string }).title,
    kind: "used" as const,
  }))
}

/** The full corpus for one trip + category: rated + planned + wanted + used. */
export async function gatherTripTasteSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted, used] = await Promise.all([
    gatherTripRatingSignals(tripId, category),
    gatherTripPlannedSignals(tripId, category),
    gatherTripWantedSignals(tripId, category),
    gatherTripSpentSignals(tripId, category),
  ])
  return [...rated, ...planned, ...wanted, ...used]
}

/** How many signals of any kind this trip holds for a category. */
export async function countTripSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<number> {
  return (await gatherTripTasteSignals(tripId, category)).length
}

export interface TripSummary {
  summaryMd: string
  signalCountAtGeneration: number
}

/** The stored per-trip summary for a category, or empty defaults when none. */
export async function getTripSummary(
  tripId: string,
  category: LearnedCategory,
): Promise<TripSummary> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_summaries")
    .select("summary_md, signal_count_at_generation")
    .eq("trip_id", tripId)
    .eq("category", category)
    .maybeSingle()
  if (!data) return { summaryMd: "", signalCountAtGeneration: 0 }
  return {
    summaryMd: data.summary_md ?? "",
    signalCountAtGeneration: data.signal_count_at_generation ?? 0,
  }
}

export interface TripLearnedBlock {
  category: LearnedCategory
  summaryMd: string
  signalCount: number
  countAtGeneration: number
}

/** The renderable per-trip blocks across all four categories, only where the trip
 * clears the signal floor. Empty array when the trip has too little signal. */
export async function getTripLearnedBlocks(
  tripId: string,
): Promise<TripLearnedBlock[]> {
  const categories: LearnedCategory[] = [
    "food",
    "activity",
    "accommodation",
    "transport",
  ]
  const blocks = await Promise.all(
    categories.map(async (category) => {
      const signalCount = await countTripSignals(tripId, category)
      if (signalCount < RATING_FLOOR) return null
      const summary = await getTripSummary(tripId, category)
      return {
        category,
        summaryMd: summary.summaryMd,
        signalCount,
        countAtGeneration: summary.signalCountAtGeneration,
      }
    }),
  )
  return blocks.filter((b): b is TripLearnedBlock => b !== null)
}
