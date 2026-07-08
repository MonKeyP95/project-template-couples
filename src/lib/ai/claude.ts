import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import type {
  DiscoveryCategory,
  DiscoveryQuery,
  DiscoverySuggestion,
} from "./discovery-types"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser.
 */

const MODEL = "claude-sonnet-4-6"

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from process.env

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
export async function summarizeTaste(
  category: DiscoveryCategory,
  currentSummaryMd: string,
  ratings: { text: string; rating: number; note: string }[],
): Promise<string> {
  const noun = category === "activity" ? "activities" : "food"
  const lines = ratings
    .map((r) => `- ${r.text} · ${r.rating}/5${r.note ? ` · ${r.note}` : ""}`)
    .join("\n")
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
          `A couple has been rating ${noun} on their trips. ${current}\n\n` +
          `Here are their ${noun} ratings (place · rating · note):\n${lines}\n\n` +
          `Write a short markdown summary (a few bullet points) of what this ` +
          `couple likes and dislikes in ${noun}. Evolve the current summary ` +
          `rather than discarding it; keep any hand-edits that still hold. ` +
          `Return only the markdown, no preamble.`,
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

  if (query.category === "activity") {
    return [
      `Find things to do in ${query.destination}.`,
      ...moment,
      learnedLine,
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
