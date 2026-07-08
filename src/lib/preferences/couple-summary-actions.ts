"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { summarizeTaste } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getCoupleSummary } from "./couple-summary-queries"
import type { LearnedCategory } from "./couple-summary-types"

/** Regenerates a category's learned summary from its ratings (AI-gated). Evolves
 * the current summary, then stamps rating_count_at_generation to the current
 * total so staleness resets. Returns the new markdown (or an error). */
export async function refreshCoupleSummary(
  category: LearnedCategory,
): Promise<{ summaryMd?: string; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const supabase = await createClient()
  const { data: rows, error: loadError } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("workspace_id", workspace.id)
    .eq("category", category)
    .order("created_at", { ascending: true })
  if (loadError) return { error: loadError.message }

  const ratings = (rows ?? []).map((r) => ({
    text: r.event_text as string,
    rating: r.rating as number,
    note: (r.note as string | null) ?? "",
  }))
  if (ratings.length === 0) return { error: "No ratings yet." }

  const current = await getCoupleSummary(workspace.id, category)
  const summaryMd = await summarizeTaste(category, current.summaryMd, ratings)

  await supabase.from("couple_summaries").upsert(
    {
      workspace_id: workspace.id,
      category,
      summary_md: summaryMd,
      rating_count_at_generation: ratings.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,category" },
  )

  revalidatePath("/profile")
  return { summaryMd }
}

/** Saves a hand-edited summary (no AI). Leaves rating_count_at_generation
 * untouched so a manual edit does not clear staleness — if still stale, the next
 * profile load regenerates and folds the edit in. */
export async function saveCoupleSummary(
  category: LearnedCategory,
  md: string,
): Promise<{ error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const supabase = await createClient()
  await supabase.from("couple_summaries").upsert(
    {
      workspace_id: workspace.id,
      category,
      summary_md: md,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,category" },
  )

  revalidatePath("/profile")
  return {}
}
