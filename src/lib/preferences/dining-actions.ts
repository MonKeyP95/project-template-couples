"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { normalizeBudgetBand, parsePreferenceList } from "./dining-types"

/** Upserts the current workspace's dining preferences from the profile form. */
export async function saveDiningPreferences(formData: FormData): Promise<void> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return

  const supabase = await createClient()
  await supabase.from("dining_preferences").upsert(
    {
      workspace_id: workspace.id,
      budget_band: normalizeBudgetBand(String(formData.get("budget_band") ?? "")),
      vibe_tags: parsePreferenceList(String(formData.get("vibe_tags") ?? "")),
      dietary: parsePreferenceList(String(formData.get("dietary") ?? "")),
      cuisines: parsePreferenceList(String(formData.get("cuisines") ?? "")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  )

  revalidatePath("/profile")
}
