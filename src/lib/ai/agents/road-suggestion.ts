import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { DispatchItem } from "@/lib/trips/dispatch-types"
import type { RoadSuggestionProposal } from "@/lib/trips/road-suggestion-types"

/**
 * The proactive suggestion AI. Runs once a day beside the dispatch agent, on
 * that agent's findings — it has no search tool of its own. Proposes one thing
 * the couple can add to today, or nothing. Edit `SYSTEM`/`tools` to change it.
 */

export interface RoadSuggestionQuery {
  /** The place they are in today — the itinerary location, else the country. */
  place: string
  dayDate: string
  /** Everything the app knows about this couple, from buildAssistantContext. */
  profileBlock: string
  tasteDirective: string
  /** Today's planned title and summary, or empty. */
  todayPlan: string
  /** What the dispatch agent just found: sourced facts it may build on. */
  dispatchItems: DispatchItem[]
  /** Titles they recently added, so it never repeats one. */
  added: string[]
  /** Titles they recently refused, so it never pushes one again. */
  refused: string[]
  /** The trip's real expense category names. */
  categories: string[]
}

const SYSTEM = [
  "You are the in-app assistant for a couple travelling together, writing the one proactive suggestion they see today.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "Answer by calling propose_road_suggestion exactly once.",
  "The suggestion must be something they can add to today: somewhere to go, something to eat, something to do.",
  "Ground it in what you are given — their plan for today, what is on locally, who they are. Never invent a place, a price or a date.",
  "Never repeat anything in their recent history, whether they added it or refused it.",
  "The app already warns them about their daily spending cap and about expenses they have not logged. Never say either.",
  "Only set sourceUrl when the suggestion builds on one of the local findings, using that finding's own URL. Never invent one.",
  "Set category to one of the trip's expense categories when one fits, copied exactly. Otherwise leave it empty.",
  "An empty title is a correct and expected answer: a day with a good plan needs nothing from you. Never pad.",
].join(" ")

function suggestionPrompt(query: RoadSuggestionQuery): string {
  const findings = query.dispatchItems
    .map((item) => `${item.title} (${item.window}) ${item.sourceUrl}`)
    .join("; ")
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    query.todayPlan
      ? `Their plan for today: ${query.todayPlan}.`
      : "Nothing is planned for today.",
    findings ? `Happening locally: ${findings}.` : "",
    query.profileBlock ? `What we know about them — ${query.profileBlock}` : "",
    query.tasteDirective,
    query.added.length ? `They recently added: ${query.added.join("; ")}.` : "",
    query.refused.length
      ? `They recently refused: ${query.refused.join("; ")}.`
      : "",
    query.categories.length
      ? `The trip's expense categories: ${query.categories.join(", ")}.`
      : "",
    "Propose one suggestion for today, or an empty title if nothing is worth saying.",
  ]
    .filter(Boolean)
    .join(" ")
}

const roadSuggestion: AgentDescriptor<
  RoadSuggestionQuery,
  RoadSuggestionProposal | null
> = {
  name: "road-suggestion",
  model: "claude-sonnet-4-6",
  maxTokens: 512,
  system: SYSTEM,
  tools: ["propose_road_suggestion"],
  toolChoice: { type: "tool", name: "propose_road_suggestion" },
  mcpServers: [],
  buildInput: (query) => suggestionPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_road_suggestion",
    )
    if (!proposal) return null
    const data = proposal.input as Partial<RoadSuggestionProposal>
    const title = (data.title ?? "").trim()
    // An empty title is the agent saying "nothing today" — the one answer that
    // must never become a card.
    if (!title) return null
    return {
      title,
      body: (data.body ?? "").trim(),
      category: (data.category ?? "").trim(),
      suggestedTime: (data.suggestedTime ?? "").trim(),
      sourceUrl: (data.sourceUrl ?? "").trim(),
    }
  },
}

/** One suggestion for today, or null on a day that needs nothing. */
export function proposeRoadSuggestion(
  query: RoadSuggestionQuery,
): Promise<RoadSuggestionProposal | null> {
  return runAgent(roadSuggestion, query)
}
