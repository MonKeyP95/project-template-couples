import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { TripIdea } from "@/lib/ai/suggestion-types"

/** The saved set and the hash of what it was built from. */
export type SavedHomeIdeas = { fingerprint: string; ideas: TripIdea[] }

/** The workspace's saved home ideas, or null before the first set is made. */
export async function getHomeIdeas(workspaceId: string): Promise<SavedHomeIdeas | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("home_ideas")
    .select("fingerprint, ideas")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  return data
}

/** Replaces the workspace's saved home ideas. */
export async function saveHomeIdeas(
  workspaceId: string,
  saved: SavedHomeIdeas,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("home_ideas").upsert({
    workspace_id: workspaceId,
    ...saved,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}
