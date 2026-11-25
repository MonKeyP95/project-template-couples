import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { EarlierIdea, TripIdea } from "@/lib/ai/suggestion-types"

const IDEA_COLUMNS = "id, pill, label, body, plan"
const EARLIER_LIMIT = 50
const RECENT_LABELS = 30

/** The hash of what the pills were built from, or null before the first set. */
export async function getFingerprint(workspaceId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("home_ideas")
    .select("fingerprint")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  return data?.fingerprint ?? null
}

export async function saveFingerprint(workspaceId: string, fingerprint: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("home_ideas").upsert({
    workspace_id: workspaceId,
    fingerprint,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

/** The ideas on the pills, oldest first so their order holds. */
export async function listPills(workspaceId: string): Promise<TripIdea[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_ideas")
    .select(IDEA_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("on_pills", true)
    .order("created_at")
  return data ?? []
}

/** The newest ideas not on the pills, with the slug of any trip made from one. */
export async function listEarlier(workspaceId: string): Promise<EarlierIdea[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_ideas")
    .select(`${IDEA_COLUMNS}, created_at, trips(slug)`)
    .eq("workspace_id", workspaceId)
    .eq("on_pills", false)
    .order("created_at", { ascending: false })
    .limit(EARLIER_LIMIT)
  // A many-to-one join returns one object or null; untyped, it reads as a list.
  const rows = (data ?? []) as unknown as (TripIdea & {
    created_at: string
    trips: { slug: string } | null
  })[]
  return rows.map(({ created_at, trips, ...idea }) => ({
    ...idea,
    createdAt: created_at,
    tripSlug: trips?.slug ?? null,
  }))
}

/** Destinations already suggested, newest first, for "not these again". */
export async function recentLabels(workspaceId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_ideas")
    .select("label")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LABELS)
  return (data ?? []).map((r) => r.label)
}

/** Saves new ideas and returns them with their ids. */
export async function insertIdeas(
  workspaceId: string,
  ideas: TripIdea[],
  onPills: boolean,
): Promise<TripIdea[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_ideas")
    .insert(
      ideas.map(({ pill, label, body, plan }) => ({
        workspace_id: workspaceId,
        pill,
        label,
        body,
        plan,
        on_pills: onPills,
      })),
    )
    .select(IDEA_COLUMNS)
  if (error) throw error
  return data
}

/** Moves every pill idea to the list. */
export async function clearPills(workspaceId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_ideas")
    .update({ on_pills: false })
    .eq("workspace_id", workspaceId)
    .eq("on_pills", true)
  if (error) throw error
}
