import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"

/**
 * The budget planner AI. Prices the gaps in a couple's trip budget with bounded
 * web search. Suggest-only: returns data, never writes. Edit `system`, `tools`,
 * or `mcpServers` to change its behavior.
 */

export interface BudgetFillContext {
  destination: string
  tripDays: number
  memberCount: number
  budgetBand: string
  profileBlock: string
  tasteDirective: string
  locations: { name: string; nights: number; dateLabel: string | null }[]
  /** Lines the couple already priced — context only, never re-priced. */
  priced: { category: string; place: string; subject: string; whenLabel: string; amountEuros: number }[]
  /** Lines needing a price, index-matched to the returned fills. */
  unpriced: { category: string; place: string; subject: string; whenLabel: string }[]
}

export interface BudgetFillResult {
  /** fills[i] is the price for unpriced[i], or null if none was reliable. */
  fills: (number | null)[]
  /** fillSources[i] is the backing URL for fills[i], or null. */
  fillSources: (string | null)[]
}

function budgetFillPrompt(c: BudgetFillContext): string {
  const places = c.locations.length
    ? c.locations.map((l) => `${l.name} (${l.dateLabel ?? `${l.nights} nights`})`).join("; ")
    : "no specific places listed"
  const line = (p: { category: string; place: string; subject: string; whenLabel: string }) =>
    `${p.category}${p.place ? ` @ ${p.place}` : ""}: ${p.subject || "(unlabelled)"}${p.whenLabel ? ` [${p.whenLabel}]` : ""}`
  const priced = c.priced.length
    ? c.priced.map((p) => `- ${line(p)} = EUR ${p.amountEuros}`).join("\n")
    : "(none)"
  const unpriced = c.unpriced.length
    ? c.unpriced.map((u, i) => `${i}. ${line(u)}`).join("\n")
    : "(none)"
  return [
    `Draft the money side of a ${c.tripDays}-day trip to ${c.destination} for ${c.memberCount} people.`,
    `Places in order: ${places}.`,
    c.budgetBand ? `The couple's usual spending level: ${c.budgetBand}.` : "",
    c.profileBlock,
    c.tasteDirective,
    "",
    "Prices already decided (context only, do NOT re-price):",
    priced,
    "",
    "Lines that need a price, by index:",
    unpriced,
    "",
    "Return a price for each indexed line via fills. Do not add any new lines. " +
      "Search only named or big-ticket items; estimate the everyday ones.",
  ]
    .filter(Boolean)
    .join("\n")
}

const budgetPlanner: AgentDescriptor<BudgetFillContext, BudgetFillResult | null> = {
  name: "budget-planner",
  model: "claude-sonnet-4-6",
  maxTokens: 3072,
  maxTurns: 8,
  system:
    "You price the gaps in a couple's trip budget. Never ask questions or reply " +
    "conversationally — you cannot receive a reply. You MUST end by calling " +
    "submit_budget. Use the web_search tool ONLY for named or big-ticket items " +
    "(a specific hotel or hostel, flights and transfers, a named activity) to find " +
    "a real, current price; for everyday gaps (daily food, local transport, small " +
    "extras) estimate from typical costs for the destination, season, trip length " +
    "and party size. Every amount is a whole-euro figure for the whole line (whole " +
    "party, whole stay). NEVER fabricate: if you cannot find or reasonably estimate " +
    "a price, return amountEuros -1 for that line. When a web search produced the " +
    "number, set sourceUrl to that result's real URL; otherwise set sourceUrl to an " +
    "empty string. Never re-price a line the couple already decided. Price only " +
    "the lines given -- never invent new activities, trips or experiences to add; " +
    "that is the itinerary planner's job, not yours.",
  tools: ["web_search", "submit_budget"],
  mcpServers: [],
  buildInput: (c) => budgetFillPrompt(c),
  parseOutput: (message, input) => {
    const submit = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "submit_budget",
    )
    if (!submit) return null
    const data = submit.input as {
      fills?: { index: number; amountEuros: number; sourceUrl: string }[]
    }
    const fills: (number | null)[] = new Array(input.unpriced.length).fill(null)
    const fillSources: (string | null)[] = new Array(input.unpriced.length).fill(null)
    for (const f of data.fills ?? []) {
      if (f.index < 0 || f.index >= input.unpriced.length) continue
      fills[f.index] = f.amountEuros >= 0 ? f.amountEuros : null
      fillSources[f.index] = f.sourceUrl ? f.sourceUrl : null
    }
    return { fills, fillSources }
  },
}

/** Price the budget gaps with bounded web search. Returns null on failure. */
export function draftBudgetFill(
  context: BudgetFillContext,
): Promise<BudgetFillResult | null> {
  return runAgent(budgetPlanner, context)
}
