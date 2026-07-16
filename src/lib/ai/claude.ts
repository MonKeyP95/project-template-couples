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
import { budgetPlannerSkill } from "./skills/budget-planner"
import { itineraryPlannerSkill } from "./skills/itinerary-planner"
import { resolveTools } from "./skills/registry"
import type {
  LearnedCategory,
  TasteSignal,
} from "@/lib/preferences/couple-summary-types"

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
  if (s.kind === "used") return `- ${s.text} · booked & paid on a trip (real)`
  return `- ${s.text} · wanted`
}

const LEARNED_NOUN: Record<LearnedCategory, string> = {
  food: "food",
  activity: "activities",
  accommodation: "places to stay",
  transport: "ways of getting around",
}

export async function summarizeTaste(
  category: LearnedCategory,
  currentSummaryMd: string,
  signals: TasteSignal[],
): Promise<string> {
  const noun = LEARNED_NOUN[category]
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
          `A couple leaves signals about their ${noun} across their trips: places ` +
          `they rated, places they planned but never rated, things they said they ` +
          `wanted, and places or modes they actually booked and paid for. ${current}\n\n` +
          `Here are the signals:\n${lines}\n\n` +
          `Weight rated highest and actually-booked ("booked & paid") next as real ` +
          `behaviour; treat "planned" and "wanted" as lighter hints about direction. ` +
          `Write a short markdown summary (a few bullet points) of what this couple ` +
          `likes and dislikes in ${noun}. Evolve the current summary rather than ` +
          `discarding it; keep any hand-edits that still hold. Return only the ` +
          `markdown, no preamble.`,
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

// Budget fill. The couple has walked their costs entering the prices they know;
// this prices the gaps. Uses the built-in web_search tool (like discovery) ONLY
// for named / big-ticket items, estimates the everyday ones, and honestly marks
// what it could not price. Prices only the lines that already exist -- inventing
// new activities is the itinerary planner's job, not this one. Suggest-only:
// returns data, never writes.

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

/** Price the budget gaps with bounded web search. Returns null on failure. */
export async function draftBudgetFill(
  context: BudgetFillContext,
): Promise<BudgetFillResult | null> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: budgetFillPrompt(context) },
  ]

  // Bounded loop only to resume the server-side search loop on pause_turn.
  for (let i = 0; i < 8; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: budgetPlannerSkill.prompt,
      tools: resolveTools(budgetPlannerSkill.toolNames),
      messages,
    })

    const submit = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "submit_budget",
    )
    if (submit) {
      const input = submit.input as {
        fills?: { index: number; amountEuros: number; sourceUrl: string }[]
      }
      const fills: (number | null)[] = new Array(context.unpriced.length).fill(null)
      const fillSources: (string | null)[] = new Array(context.unpriced.length).fill(null)
      for (const f of input.fills ?? []) {
        if (f.index < 0 || f.index >= context.unpriced.length) continue
        fills[f.index] = f.amountEuros >= 0 ? f.amountEuros : null
        fillSources[f.index] = f.sourceUrl ? f.sourceUrl : null
      }
      return { fills, fillSources }
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content })
      continue
    }

    // Finished without submitting — no usable fill.
    return null
  }
  return null
}

export interface DraftedItineraryEvent {
  /** One of: Activities, Food, Transportation. */
  category: string
  /** The exact itinerary location name this event belongs to. */
  place: string
  /** Short label, e.g. "Surf lesson at the point" or "Dinner - seafood". */
  text: string
  /** YYYY-MM-DD within the trip; may be empty if undated. */
  date: string
  /** HH:MM, may be empty. */
  time: string
}

export interface ItineraryDraftContext {
  destination: string
  startDate: string
  dayCount: number
  locations: { name: string; nights: number; dateLabel: string | null }[]
  vibe: string[]
  brief: string
  activityTypes: string[]
  freeText: string
  /** What the couple already chose in the guided walk; the itinerary is built
   * around these, then gaps filled sparsely. */
  knownPlans: { category: string; place: string; subject: string; when: string }[]
  profileBlock: string
  tasteDirective: string
}

function itineraryPrompt(c: ItineraryDraftContext): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const places = c.locations.length
    ? c.locations.map((l) => `${l.name} (${l.dateLabel ?? `${l.nights} nights`})`).join("; ")
    : c.destination
  const known = c.knownPlans.length
    ? c.knownPlans
        .map(
          (k) =>
            `${k.subject}${k.place ? ` in ${k.place}` : ""}${k.when ? ` (${k.when})` : ""} [${k.category}]`,
        )
        .join("; ")
    : ""
  return [
    `Draft a ${c.dayCount}-day itinerary for ${c.destination}, starting ${c.startDate}.`,
    `Places in order: ${places}.`,
    known
      ? `Plans they already chose (include each of these in the itinerary, on the dates or nights they gave, then fill the gaps sparsely): ${known}.`
      : "",
    list("Trip vibe", c.vibe),
    c.brief ? `Trip brief: ${c.brief}.` : "",
    list("Activity types they want", c.activityTypes),
    c.freeText ? `They also said: ${c.freeText}.` : "",
    c.profileBlock ? `Who they are (a lens, not a checklist): ${c.profileBlock}` : "",
    c.tasteDirective,
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real Claude itinerary draft. Returns sparse, grounded events, OR an empty
 * events array plus one clarifying question when the input is too thin. */
export async function draftItinerary(
  context: ItineraryDraftContext,
): Promise<{ events: DraftedItineraryEvent[]; question: string }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: itineraryPlannerSkill.prompt,
    tools: resolveTools(itineraryPlannerSkill.toolNames),
    tool_choice: { type: "tool", name: "propose_itinerary" },
    messages: [{ role: "user", content: itineraryPrompt(context) }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_itinerary",
  )
  if (!proposal) return { events: [], question: "" }
  const input = proposal.input as { events?: DraftedItineraryEvent[]; question?: string }
  return { events: input.events ?? [], question: input.question ?? "" }
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
