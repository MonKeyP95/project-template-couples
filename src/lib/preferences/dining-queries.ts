import { createClient } from "@/lib/supabase/server"
import {
  EMPTY_DINING_PREFERENCES,
  normalizeBudgetBand,
  type DiningPreferences,
} from "./dining-types"

/** The workspace's dining preferences, or empty defaults when unset. */
export async function getDiningPreferences(
  workspaceId: string,
): Promise<DiningPreferences> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("dining_preferences")
    .select("budget_band, vibe_tags, dietary, cuisines")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!data) return EMPTY_DINING_PREFERENCES

  return {
    budgetBand: normalizeBudgetBand(data.budget_band),
    vibeTags: data.vibe_tags ?? [],
    dietary: data.dietary ?? [],
    cuisines: data.cuisines ?? [],
  }
}
