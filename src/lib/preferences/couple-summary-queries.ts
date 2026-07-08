import { createClient } from "@/lib/supabase/server"
import type { LearnedCategory } from "./couple-summary-types"

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
