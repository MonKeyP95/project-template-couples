import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { TripIdea } from "@/lib/ai/suggestion-types"
import type { IdeaPlan } from "@/lib/trips/idea-route"

/** A saved idea; `plan` is null on rows saved before it existed. */
export type SavedHomeIdea = Omit<TripIdea, "plan"> & {
  plan: IdeaPlan | null
  fingerprint: string
}

/** The workspace's saved home idea, or null before the first one is made. */
export async function getHomeIdea(workspaceId: string): Promise<SavedHomeIdea | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("home_ideas")
    .select("fingerprint, label, body, options, plan")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  return data
}

/** Replaces the workspace's saved home idea. */
export async function saveHomeIdea(
  workspaceId: string,
  idea: TripIdea & { fingerprint: string },
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("home_ideas").upsert({
    workspace_id: workspaceId,
    ...idea,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}
