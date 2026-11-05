import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { SuggestionKind, SuggestionOption } from "@/lib/trips/suggestion-types"

/**
 * The suggestion-options AI. Searches the web for real options behind one
 * planner suggestion (big: 2-3 to compare; small: one place), then calls
 * propose_options. Never invents a price, rating or URL. Edit `SYSTEM`/`tools`
 * to change it.
 */

export interface SuggestionOptionsQuery {
  kind: SuggestionKind
  category: string
  title: string
  why: string
  /** The itinerary location it belongs to, or empty. */
  place: string
  /** The trip's name and country, for when `place` is empty. */
  destination: string
  /** The trip's spend currency, used when a price's currency is unclear. */
  currency: string
}

const SYSTEM = [
  "You find real, bookable options behind one travel suggestion for a couple.",
  "Never ask questions and never reply conversationally - you cannot receive a reply.",
  "On every request you MUST use the web_search tool first, then call propose_options.",
  "Every option must be a real, currently operating business or place from a search result, with that result's URL.",
  "Never invent a price, a rating or a URL: if the search does not show a price, set priceCents to null; if it shows no rating, leave reviews empty.",
  "Options for one suggestion must be comparable: the same kind of thing from different providers.",
].join(" ")

function optionsPrompt(q: SuggestionOptionsQuery): string {
  const where = q.place ? `${q.place} (${q.destination})` : q.destination
  const count =
    q.kind === "big"
      ? "Find 2 to 3 comparable options from different providers."
      : "Find the one best place for it."
  return [
    `The suggestion: "${q.title}" (${q.category}) in ${where}.`,
    q.why ? `Why it was suggested: ${q.why}.` : "",
    count,
    `If a price's currency is unclear, it is ${q.currency}.`,
    "Then call propose_options.",
  ]
    .filter(Boolean)
    .join(" ")
}

const suggestionOptions: AgentDescriptor<SuggestionOptionsQuery, SuggestionOption[]> = {
  name: "suggestion-options",
  model: "claude-sonnet-4-6",
  maxTokens: 2048,
  maxTurns: 6,
  system: SYSTEM,
  tools: ["web_search_short", "propose_options"],
  mcpServers: [],
  buildInput: (q) => optionsPrompt(q),
  parseOutput: (message, q) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_options",
    )
    if (!proposal) return []
    const data = proposal.input as { options?: SuggestionOption[] }
    // An option with no link cannot be checked, so it is not an option.
    return (data.options ?? [])
      .filter((o) => o.url.trim())
      .slice(0, q.kind === "big" ? 3 : 1)
  },
}

/** Real, search-backed options for one suggestion. [] when none were found. */
export function findSuggestionOptions(q: SuggestionOptionsQuery): Promise<SuggestionOption[]> {
  return runAgent(suggestionOptions, q)
}
