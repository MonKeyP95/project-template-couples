"use server"

import { createHash } from "node:crypto"

import { generateTripIdeas } from "@/lib/ai/claude"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { buildHomeContext } from "@/lib/ai/home-idea-context"
import { getHomeIdeas, saveHomeIdeas } from "@/lib/ai/home-idea-queries"
import type { TripIdea } from "@/lib/ai/suggestion-types"
import { localToday } from "@/lib/time/local-today"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

const SET_SIZE = 3

/** The saved set of home ideas, made again only when what it was built from
 * changed (profile or trip learnings) or when `fresh` is asked ("new ideas").
 * Not gated on AI mode: it runs on its own, at most once per change. */
export async function refreshHomeIdeas(
  fresh: boolean,
): Promise<{ ideas?: TripIdea[]; error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const context = await buildHomeContext(workspace.id, null)
  const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id)
  const fingerprint = createHash("sha256").update(context + profileBlock).digest("hex")
  const saved = await getHomeIdeas(workspace.id)
  // An empty set (a row from before sets existed) is made again once.
  if (!fresh && saved?.fingerprint === fingerprint && saved.ideas.length)
    return { ideas: saved.ideas }

  const notAgain = fresh && saved?.ideas.length
    ? `Not ${saved.ideas.map((i) => i.label).join(", ")} again.`
    : ""
  try {
    const ideas = await generateTripIdeas(
      [
        `Today is ${await localToday()}.`,
        context,
        profileBlock ? `Who they are: ${profileBlock} ${tasteDirective}` : "",
        notAgain,
      ].join(" "),
      SET_SIZE,
    )
    await saveHomeIdeas(workspace.id, { fingerprint, ideas })
    return { ideas }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}

/** Removes one idea (by label) from the saved set, with no call. An emptied
 * set is made again by the next `refreshHomeIdeas`. */
export async function dismissHomeIdea(label: string): Promise<void> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return
  const saved = await getHomeIdeas(workspace.id)
  if (!saved) return
  await saveHomeIdeas(workspace.id, {
    fingerprint: saved.fingerprint,
    ideas: saved.ideas.filter((i) => i.label !== label),
  })
}
