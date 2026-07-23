import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { anthropic } from "./client"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Each AI is a per-file descriptor under agents/*.ts, run by the shared
 * runAgent (runtime.ts). This file re-exports their public entry points so
 * callers keep importing from "@/lib/ai/claude", and holds the trivial ping.
 */

export { chatReply } from "./agents/chat"
export { summarizeTaste } from "./agents/summarize-taste"
export { discover } from "./agents/discover"
export {
  draftBudgetFill,
  type BudgetFillContext,
  type BudgetFillResult,
} from "./agents/budget-planner"
export {
  draftItinerary,
  type DraftedItineraryEvent,
  type ItineraryDraftContext,
} from "./agents/itinerary-planner"
export { generateSuggestion } from "./agents/suggestion"

/** A trivial real round-trip. Returns Claude's reply text (expected: "pong"). */
export async function pingClaude(): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}
