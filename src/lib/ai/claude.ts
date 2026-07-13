import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import type { ChatMessage } from "./chat-types"
import type {
  DiscoveryCategory,
  DiscoveryQuery,
  DiscoverySuggestion,
} from "./discovery-types"
import type { Suggestion } from "./suggestion-types"
import { TASTE_DIRECTIVE } from "./taste-types"
import type { TasteSignal } from "@/lib/preferences/couple-summary-types"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser.
 */

const MODEL = "claude-sonnet-4-6"

// Chat uses its own model constant so it can be dropped to a cheaper model
// (e.g. claude-haiku-4-5) without touching the web-search discovery flow.
const CHAT_MODEL = "claude-sonnet-5"

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from process.env

// The chat behavior contract (the "harness"). Chat is the one conversational
// surface that CAN receive a reply, so it is the only place the clarify-then-act
// rule applies -- the one-shot discovery/budget/suggestion prompts must not ask.
const CHAT_HARNESS =
  "You are the in-app travel assistant for a couple planning and taking " +
  "trips together. Be warm, concise, and practical, and give concrete, " +
  "actionable answers. You are suggest-only: you advise, and you never claim " +
  "to have edited their trip, budget, itinerary, packing list, or notes. " +
  "Clarify before you act: when a request turns on a specific you do not " +
  "have -- above all which place -- ask exactly one focused follow-up " +
  "question and wait, then answer once they tell you. Do not ask when the " +
  "context already pins the answer down or a sensible general answer exists; " +
  "one question, and only when you genuinely need it. Treat any itinerary " +
  "places given to you below as the set of places you know: if a request " +
  "implies a place and none is pinned, ask which one."

function chatSystem(tripContext: string): string {
  const context = tripContext.trim()
  return context ? `${CHAT_HARNESS}\n\n${context}` : CHAT_HARNESS
}

/** A real, non-streaming assistant reply. Stateless: the full history is sent
 * each call. tripContext (empty off a trip page) is folded into the system
 * prompt. Suggest-only: returns text; it never writes. */
export async function chatReply(
  messages: ChatMessage[],
  tripContext: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: chatSystem(tripContext),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}

/** A trivial real round-trip. Returns Claude's reply text (expected: "pong"). */
export async function pingClaude(): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}

/** Distil a couple's category ratings into a short markdown summary, evolving
 * their current summary (which may contain hand-edits) rather than replacing it.
 * Plain messages.create — no web_search. Suggest-only: returns text; the caller
 * persists it. */
function signalToLine(s: TasteSignal): string {
  if (s.kind === "rated") {
    const note = s.note ? ` · ${s.note}` : ""
    return `- ${s.text} · rated ${s.rating}/5${note}`
  }
  if (s.kind === "planned") return `- ${s.text} · planned (not rated)`
  return `- ${s.text} · wanted`
}

export async function summarizeTaste(
  category: DiscoveryCategory,
  currentSummaryMd: string,
  signals: TasteSignal[],
): Promise<string> {
  const noun = category === "activity" ? "activities" : "food"
  const lines = signals.map(signalToLine).join("\n")
  const current = currentSummaryMd.trim()
    ? `Their current ${noun} summary (may include their own hand-edits — respect ` +
      `them):\n\n${currentSummaryMd.trim()}`
    : `They have no ${noun} summary yet.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content:
          `A couple leaves signals about their ${noun} taste across their trips: ` +
          `places they rated, places they planned but never rated, and ${noun} ` +
          `they said they wanted. ${current}\n\n` +
          `Here are the signals:\n${lines}\n\n` +
          `Weight the rated places most; treat "planned" and "wanted" as lighter ` +
          `hints about direction, not firm evidence. Write a short markdown ` +
          `summary (a few bullet points) of what this couple likes and dislikes ` +
          `in ${noun}. Evolve the current summary rather than discarding it; keep ` +
          `any hand-edits that still hold. Return only the markdown, no preamble.`,
      },
    ],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}

// Discovery. Claude uses the server-side web_search tool to find real, current
// places for a category (food or activity), then calls propose_places with a
// structured shortlist. Structured-extraction-via-tool-use keeps the result
// typed without fighting citations. The model never writes anything; the caller
// only reads the proposal.

const DISCOVERY_TOOLS: Anthropic.Messages.ToolUnion[] = [
  // Basic web_search (not the _20260209 variant): its built-in "dynamic
  // filtering" spins up server-side code_execution to pre-filter results,
  // which tripled latency for no quality gain. Cap rounds too — 3 is plenty.
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  {
    name: "propose_places",
    description: "Return the final shortlist of place suggestions.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              why: {
                type: "string",
                description: "One sentence on why it fits this couple/trip.",
              },
              area: { type: "string", description: "Neighbourhood or area." },
              priceHint: {
                type: "string",
                description:
                  "Rough cost feel as text (e.g. 'mid-range'). Never an exact price.",
              },
              sourceUrl: {
                type: "string",
                description: "A real URL from the web search backing this pick.",
              },
            },
            required: ["name", "why", "area", "priceHint", "sourceUrl"],
          },
        },
      },
      required: ["suggestions"],
    },
  },
]

/** System prompt for a category. Only the noun differs between food and
 * activity; the search discipline and precedence rule are shared. */
function discoverySystem(category: DiscoveryCategory): string {
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

/** Real web-search-backed shortlist for a trip + category. Returns [] if the
 * model finishes without proposing. */
export async function discover(
  query: DiscoveryQuery,
): Promise<DiscoverySuggestion[]> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: discoveryPrompt(query) },
  ]

  // Bounded loop only to resume the server-side search loop on pause_turn.
  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: discoverySystem(query.category),
      tools: DISCOVERY_TOOLS,
      messages,
    })

    const proposal = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_places",
    )
    if (proposal) {
      const input = proposal.input as { suggestions?: DiscoverySuggestion[] }
      return input.suggestions ?? []
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content })
      continue
    }

    // Finished (end_turn / max_tokens) without proposing — no usable results.
    return []
  }
  return []
}

// Budget draft. Claude proposes concrete line items with realistic,
// destination-and-trip-aware amounts, filling the deterministic interview
// scaffold. Plain messages.create + a forced structured tool (no web_search — a
// budget is an estimate; parametric cost knowledge answers in one round-trip and
// web search tripled discovery latency for no gain). Suggest-only: returns data.

export interface DraftedBudgetItem {
  /** One of the five category labels: Accommodation, Transportation, Food, Activities, Other. */
  category: string
  /** An itinerary location name (for Accommodation/Activities), else empty (trip-wide). */
  place: string
  subject: string
  whenLabel: string
  /** Whole-euro estimate; never an exact quoted price. */
  amountEuros: number
}

export interface BudgetDraftContext {
  destination: string
  tripDays: number
  memberCount: number
  locations: { name: string; nights: number; dateLabel: string | null }[]
  vibe: string[]
  brief: string
  budgetBand: string
}

const BUDGET_TOOL: Anthropic.Messages.ToolUnion = {
  name: "propose_budget",
  description: "Return the drafted budget line items.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["Accommodation", "Transportation", "Food", "Activities", "Other"],
              description: "Which budget category this line belongs to.",
            },
            place: {
              type: "string",
              description:
                "For Accommodation/Activities, the exact itinerary location name given. Empty for Transportation/Food/Other.",
            },
            subject: {
              type: "string",
              description: "Short label for the line, e.g. 'Riad in the medina'.",
            },
            whenLabel: {
              type: "string",
              description: "Short duration/when text, e.g. '3 nights' or '7 days'. May be empty.",
            },
            amountEuros: {
              type: "number",
              description:
                "Whole-euro estimate for the whole line (all members, whole stay). Never an exact quoted price.",
            },
          },
          required: ["category", "place", "subject", "whenLabel", "amountEuros"],
        },
      },
    },
    required: ["items"],
  },
}

const BUDGET_SYSTEM =
  "You draft a realistic trip budget for a couple or family. You never ask " +
  "questions or reply conversationally — you cannot receive a reply. You MUST " +
  "call propose_budget with concrete line items across the five categories " +
  "(Accommodation, Transportation, Food, Activities, Other). Estimate amounts " +
  "from real typical costs for the given destination, season, trip length, and " +
  "party size — a whole-euro figure per line covering the whole party and whole " +
  "stay. For Accommodation and Activities, set place to the exact itinerary " +
  "location name given, one or more lines per place. For Transportation, Food, " +
  "and Other, leave place empty. Weight the trip's stated style: a relaxed or " +
  "off-the-beaten-path brief is cheaper than a luxe one. Give a couple of " +
  "activity ideas per place; skip Other unless something obvious applies " +
  "(insurance, a buffer). Never quote an exact price."

function budgetPrompt(c: BudgetDraftContext): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const places = c.locations.length
    ? c.locations
        .map((l) => `${l.name} (${l.dateLabel ?? `${l.nights} nights`})`)
        .join("; ")
    : "no specific places listed"
  return [
    `Draft a budget for a ${c.tripDays}-day trip to ${c.destination} for ${c.memberCount} people.`,
    `Places in order: ${places}.`,
    c.budgetBand ? `The couple's usual spending level: ${c.budgetBand}.` : "",
    list("Trip vibe", c.vibe),
    c.brief ? `Trip brief: ${c.brief}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real Claude budget draft. Returns [] if the model finishes without proposing. */
export async function draftBudgetSeeds(
  context: BudgetDraftContext,
): Promise<DraftedBudgetItem[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: BUDGET_SYSTEM,
    tools: [BUDGET_TOOL],
    tool_choice: { type: "tool", name: "propose_budget" },
    messages: [{ role: "user", content: budgetPrompt(context) }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_budget",
  )
  if (!proposal) return []
  const input = proposal.input as { items?: DraftedBudgetItem[] }
  return input.items ?? []
}

// --- Suggestions ---

const SUGGESTION_TOOL: Anthropic.Messages.ToolUnion = {
  name: "propose_suggestion",
  description: "Return one short, actionable suggestion for the couple.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      label: {
        type: "string",
        description:
          "A terse header in the app's voice, e.g. '/ suggested' or '/ assistant'.",
      },
      body: {
        type: "string",
        description:
          "One to two sentences: a specific, actionable suggestion grounded in the given context. No preamble.",
      },
    },
    required: ["label", "body"],
  },
}

const SUGGESTION_SYSTEM =
  "You are the in-app assistant for a couple planning and taking trips " +
  "together. Given a surface and its current trip context, propose exactly one " +
  "short, specific, actionable suggestion for that surface. Ground it in the " +
  "context provided; never invent facts (place names, dates, prices) not given. " +
  "Keep the body to one or two sentences. Return only the propose_suggestion tool."

/** One real suggestion for a surface, from a context prompt the caller builds.
 * Plain messages.create, no web_search. Suggest-only: returns text, never
 * writes. Throws when the model returns no tool block. */
export async function generateSuggestion(prompt: string): Promise<Suggestion> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SUGGESTION_SYSTEM,
    tools: [SUGGESTION_TOOL],
    tool_choice: { type: "tool", name: "propose_suggestion" },
    messages: [{ role: "user", content: prompt }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_suggestion",
  )
  if (!proposal) throw new Error("No suggestion returned")
  const input = proposal.input as { label?: string; body?: string }
  return { label: input.label ?? "/ suggested", body: input.body ?? "" }
}
