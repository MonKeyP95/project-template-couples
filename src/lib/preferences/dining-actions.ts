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
      activities: parsePreferenceList(String(formData.get("activities") ?? "")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  )

  revalidatePath("/profile")
}

/** Upserts only the Food columns of the current workspace's dining preferences. */
export async function saveFoodPreferences(formData: FormData): Promise<void> {
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

/** Upserts only the activities column of the current workspace's preferences. */
export async function saveActivities(formData: FormData): Promise<void> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return

  const supabase = await createClient()
  await supabase.from("dining_preferences").upsert(
    {
      workspace_id: workspace.id,
      activities: parsePreferenceList(String(formData.get("activities") ?? "")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  )

  revalidatePath("/profile")
}
