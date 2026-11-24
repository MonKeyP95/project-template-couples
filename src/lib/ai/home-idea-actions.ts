"use server"

import { createHash } from "node:crypto"

import { generateTripIdea } from "@/lib/ai/claude"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { buildHomeContext } from "@/lib/ai/home-idea-context"
import { getHomeIdea, saveHomeIdea } from "@/lib/ai/home-idea-queries"
import type { Suggestion } from "@/lib/ai/suggestion-types"
import { localToday } from "@/lib/time/local-today"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

/** The saved home idea, made again only when what it was built from changed
 * (profile or trip learnings) or when `another` is asked. Not gated on AI
 * mode: it runs on its own, at most once per change. */
export async function refreshHomeIdea(
  another: boolean,
): Promise<{ idea?: Suggestion; error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const context = await buildHomeContext(workspace.id, null)
  const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id)
  const fingerprint = createHash("sha256").update(context + profileBlock).digest("hex")
  const saved = await getHomeIdea(workspace.id)
  if (!another && saved?.fingerprint === fingerprint) return { idea: saved }

  try {
    const idea = await generateTripIdea(
      [
        `Today is ${await localToday()}.`,
        context,
        profileBlock ? `Who they are: ${profileBlock} ${tasteDirective}` : "",
        another && saved ? `Not ${saved.label} again.` : "",
      ].join(" "),
    )
    await saveHomeIdea(workspace.id, { ...idea, fingerprint })
    return { idea }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
