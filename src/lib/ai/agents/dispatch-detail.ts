import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { DispatchDetail, DispatchItem } from "@/lib/trips/dispatch-types"

/**
 * The dispatch-detail AI. Expands one dispatch card: with no question it tells
 * the couple what they need in order to decide whether to go; with one it
 * answers that instead. Read-only. Edit `SYSTEM`/`tools` to change it.
 */

export interface DispatchDetailQuery {
  /** Where they are — today's itinerary location, else the country. */
  place: string
  dayDate: string
  item: DispatchItem
  /** The couple's own follow-up, or empty on the first press. */
  question: string
}

const SYSTEM = [
  "You expand on one thing a couple has been told is happening where they are travelling.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "On every request you MUST use the web_search tool first, then call propose_detail.",
  "Answer only about the item you are given. Never drift onto other events.",
  "Never invent a time, a price, an address or a URL: if the search does not say it, say it is not published.",
  "Keep it to what a couple standing there would need. No history lesson, no filler.",
].join(" ")

function detailPrompt(query: DispatchDetailQuery): string {
  const { item } = query
  const ask = query.question.trim()
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    `They are looking at this item: "${item.title}" — ${item.body} (${item.window}). Source: ${item.sourceUrl}.`,
    ask
      ? `They asked: "${ask}". Search, then answer that question about this item.`
      : "Search, then tell them what they need in order to decide whether to go: what it is, where exactly, when exactly, what it costs, and how to get there.",
    "Then call propose_detail.",
  ].join(" ")
}

const EMPTY: DispatchDetail = { detail: "", links: [] }

const dispatchDetail: AgentDescriptor<DispatchDetailQuery, DispatchDetail> = {
  name: "dispatch-detail",
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  maxTurns: 6,
  system: SYSTEM,
  tools: ["web_search_short", "propose_detail"],
  mcpServers: [],
  buildInput: (query) => detailPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_detail",
    )
    if (!proposal) return EMPTY
    const data = proposal.input as Partial<DispatchDetail>
    return {
      detail: data.detail ?? "",
      // A link with no url cannot be rendered as an anchor.
      links: (data.links ?? []).filter((link) => link.url?.trim()).slice(0, 3),
    }
  },
}

/** More on one dispatch item, optionally answering the couple's own question. */
export function generateDispatchDetail(
  query: DispatchDetailQuery,
): Promise<DispatchDetail> {
  return runAgent(dispatchDetail, query)
}
