import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type {
  DiscoveryCategory,
  DiscoveryQuery,
  DiscoverySuggestion,
} from "../discovery-types"
import { TASTE_DIRECTIVE } from "../taste-types"

/**
 * The discovery AI. Uses the server-side web_search tool to find real, current
 * places for a category (stay / activity / restaurant), then calls propose_places
 * with a structured shortlist. Suggest-only. Edit `system`/`tools`/`mcpServers`
 * to change it.
 */

/** System prompt for a category. Only the noun differs between food and
 * activity; the search discipline and precedence rule are shared. */
function discoverySystem(category: DiscoveryCategory): string {
  if (category === "stay") {
    return (
      "You help a couple find places to stay for a trip. Never ask the user " +
      "questions or reply conversationally — you cannot receive a reply. On every " +
      "request you MUST: (1) use the web_search tool to find real, currently-" +
      "operating places to stay in or near the destination, then (2) call " +
      "propose_places with 3 to 4 options. If their preferences are sparse, search " +
      "for well-regarded, broadly-appealing places to stay for that destination " +
      "anyway — do not ask for more detail. Every suggestion must come from a real " +
      "search result and include that result's URL as sourceUrl. Never invent a " +
      "place, a URL, or an exact price. Keep each 'why' to one sentence. When " +
      "choosing, weight the requested area and price band first, then this trip's " +
      "vibe and brief, then the couple's general tastes."
    )
  }
  const noun = category === "activity" ? "things to do" : "restaurants"
  return (
    `You help a couple find ${noun} for a trip. Never ask the user questions ` +
    "or reply conversationally — you cannot receive a reply. On every request you " +
    `MUST: (1) use the web_search tool to find real, currently-open ${noun} ` +
    "near the destination, then (2) call propose_places with 3 to 4 options. " +
    "If their preferences are sparse, search for well-regarded, broadly-appealing " +
    `${noun} for that destination anyway — do not ask for more detail. Every ` +
    "suggestion must come from a real search result and include that result's URL " +
    "as sourceUrl. Never invent a place, a URL, or an exact price. Keep each " +
    "'why' to one sentence. When choosing, weight what they are in the mood for " +
    "right now first, then this trip's vibe and brief, then the couple's general " +
    "tastes. If told they are on foot, only propose places genuinely within " +
    "walking distance of the given anchor — never somewhere that needs a car or a " +
    "long ride."
  )
}

function discoveryPrompt(query: DiscoveryQuery): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const anchor = query.near || query.destination
  const tripLines = [
    list("This trip's vibe", query.trip.vibe),
    query.trip.brief ? `Trip brief: ${query.trip.brief}.` : "",
  ].filter(Boolean)
  const moment = [
    query.craving ? `Right now they are in the mood for: ${query.craving}.` : "",
    query.walkable
      ? `They are on foot — only suggest places within easy walking distance of ${anchor}.`
      : query.near
        ? `Prefer places near ${query.near}.`
        : "",
  ]
  const learnedLine = query.learned.trim()
    ? `From past trips, this couple has especially enjoyed: ${query.learned.trim()}`
    : ""
  const dialLine = TASTE_DIRECTIVE[query.taste]

  if (query.category === "stay") {
    const areaLine = query.near ? `Preferred area: ${query.near}.` : ""
    const priceLine =
      query.budgetBand && query.budgetBand !== "any"
        ? `Price band: ${query.budgetBand}.`
        : ""
    return [
      `Find places to stay in ${query.destination}.`,
      areaLine,
      priceLine,
      learnedLine,
      dialLine,
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }

  if (query.category === "activity") {
    return [
      `Find things to do in ${query.destination}.`,
      ...moment,
      learnedLine,
      dialLine,
      "The couple generally —",
      list("Activities they enjoy", query.activities),
      list("Vibe", query.vibeTags),
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }

  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    ...moment,
    learnedLine,
    dialLine,
    "The couple generally —",
    `Budget: ${query.budgetBand}.`,
    list("Vibe", query.vibeTags),
    list("Dietary needs", query.dietary),
    list("Cuisines they love", query.cuisines),
    list("Activities they enjoy", query.activities),
    ...(tripLines.length ? ["This trip —", ...tripLines] : []),
  ]
    .filter(Boolean)
    .join(" ")
}

const discovery: AgentDescriptor<DiscoveryQuery, DiscoverySuggestion[]> = {
  name: "discover",
  model: "claude-sonnet-4-6",
  maxTokens: 2048,
  maxTurns: 6,
  system: (query) => discoverySystem(query.category),
  tools: ["web_search_short", "propose_places"],
  mcpServers: [],
  buildInput: (query) => discoveryPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_places",
    )
    if (!proposal) return []
    const data = proposal.input as { suggestions?: DiscoverySuggestion[] }
    return data.suggestions ?? []
  },
}

/** Real web-search-backed shortlist for a trip + category. Returns [] if the
 * model finishes without proposing. */
export function discover(query: DiscoveryQuery): Promise<DiscoverySuggestion[]> {
  return runAgent(discovery, query)
}
