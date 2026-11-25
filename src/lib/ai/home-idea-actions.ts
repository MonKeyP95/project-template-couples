"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"

import { generateTripIdeas } from "@/lib/ai/claude"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { buildHomeContext, buildLearnedFromTrips } from "@/lib/ai/home-idea-context"
import {
  clearPills,
  getFingerprint,
  insertIdeas,
  listPills,
  recentLabels,
  saveFingerprint,
} from "@/lib/ai/home-idea-queries"
import { createClient } from "@/lib/supabase/server"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { localToday } from "@/lib/time/local-today"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

const SET_SIZE = 3

/** A hash of who they are (profile + what was learned on past trips). The
 * trip list is left out, so creating or editing a trip keeps the pills. */
async function profileFingerprint(workspaceId: string, profileBlock: string): Promise<string> {
  const { past } = await listTripsForWorkspace(workspaceId)
  const learned = await buildLearnedFromTrips(workspaceId, past)
  return createHash("sha256").update(profileBlock + learned).digest("hex")
}

/** Makes a new set of pill ideas when `fresh` ("new ideas"), when the profile
 * changed, or when no pill is left; otherwise does nothing. The old pills move
 * to the earlier list. Not gated on AI mode: it runs on its own, at most once
 * per change. */
export async function refreshHomeIdeas(fresh: boolean): Promise<{ error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id)
  const fingerprint = await profileFingerprint(workspace.id, profileBlock)
  const pills = await listPills(workspace.id)
  if (!fresh && pills.length && (await getFingerprint(workspace.id)) === fingerprint)
    return {}

  const suggested = await recentLabels(workspace.id)
  try {
    const ideas = await generateTripIdeas(
      [
        `Today is ${await localToday()}.`,
        await buildHomeContext(workspace.id, null),
        profileBlock ? `Who they are: ${profileBlock} ${tasteDirective}` : "",
        suggested.length ? `Already suggested, pick others: ${suggested.join(", ")}.` : "",
      ].join(" "),
      SET_SIZE,
    )
    await clearPills(workspace.id)
    await insertIdeas(workspace.id, ideas, true)
    await saveFingerprint(workspace.id, fingerprint)
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
  revalidatePath("/home")
  return {}
}

/** Takes an idea off the pills; it stays in the earlier list. */
export async function dismissHomeIdea(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from("trip_ideas").update({ on_pills: false }).eq("id", id)
  revalidatePath("/home")
}

/** Deletes an idea for good. */
export async function deleteHomeIdea(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from("trip_ideas").delete().eq("id", id)
  revalidatePath("/home")
}
