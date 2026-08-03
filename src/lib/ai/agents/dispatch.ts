import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import {
  MAX_DISPATCH_ITEMS,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

/**
 * The dispatch AI. Once a day, searches for what is actually happening where
 * the couple is right now and returns at most two items. Read-only: the card it
 * feeds has no actions. Edit `SYSTEM`/`tools` to change it.
 */

export interface DispatchQuery {
  /** The place to search — today's itinerary location, else the country. */
  place: string
  dayDate: string
  /** Everything the app knows about this couple, from buildAssistantContext. */
  profileBlock: string
  tasteDirective: string
  /** Today's planned title and summary, or empty. */
  todayPlan: string
}

const SYSTEM = [
  "You brief a couple on what is happening where they are travelling today.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "On every request you MUST use the web_search tool first, then call propose_dispatch.",
  "Only three kinds of thing qualify:",
  "(1) whats_on — a festival, market, saint's day, public holiday, concert or match on or near their dates;",
  "(2) disrupted — a transport strike, closure, protest or weather warning that changes their day;",
  "(3) conditions — surf, snow, tide, jellyfish or air quality, but ONLY when what you know about this couple says they care about that activity.",
  "Never return general news: no politics, no crime, no economy. Those do not change their day.",
  "Every item MUST carry a window (a real date or span) and a sourceUrl from a search result.",
  "If you cannot date it or cannot source it, drop it.",
  `Return at most ${MAX_DISPATCH_ITEMS} items, the best ones.`,
  "Returning an empty list is a correct and expected answer: most places on most days have nothing worth saying.",
  "Never pad the list with a generic guidebook fact about the destination. Nothing is better than filler.",
].join(" ")

function dispatchPrompt(query: DispatchQuery): string {
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    query.todayPlan ? `Their plan for today: ${query.todayPlan}.` : "",
    query.profileBlock ? `What we know about them — ${query.profileBlock}` : "",
    query.tasteDirective,
    `Search for what is on, what is disrupted, and any conditions in ${query.place} for today and the next few days, then call propose_dispatch.`,
  ]
    .filter(Boolean)
    .join(" ")
}

const dispatch: AgentDescriptor<DispatchQuery, DispatchItem[]> = {
  name: "dispatch",
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  maxTurns: 6,
  system: SYSTEM,
  tools: ["web_search_short", "propose_dispatch"],
  mcpServers: [],
  buildInput: (query) => dispatchPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_dispatch",
    )
    if (!proposal) return []
    const data = proposal.input as { items?: DispatchItem[] }
    // The window and source rules are contract, not taste: an undated or
    // unsourced item is the failure mode this card exists to avoid.
    return (data.items ?? [])
      .filter((item) => item.window?.trim() && item.sourceUrl?.trim())
      .slice(0, MAX_DISPATCH_ITEMS)
  },
}

/** What is happening where they are today. Returns [] on a quiet day. */
export function generateDispatch(
  query: DispatchQuery,
): Promise<DispatchItem[]> {
  return runAgent(dispatch, query)
}
