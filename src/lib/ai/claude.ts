import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import type {
  RestaurantQuery,
  RestaurantSuggestion,
} from "./restaurant-discovery-types"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser. Slice 0 wires the SDK with one trivial call to prove
 * key/route/cost/latency in isolation; real features (the plan importer) land
 * here next, behind this same module.
 */

// The importer's default per the spec; a one-line swap to A/B against
// claude-opus-4-8 (cleaner first pass) or claude-haiku-4-5 (cheaper) later.
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

// Restaurant discovery (slice B1). Claude uses the server-side web_search tool
// to find real, current restaurants, then calls propose_restaurants with a
// structured shortlist. Structured-extraction-via-tool-use keeps the result
// typed without fighting citations. The model never writes anything; the caller
// only reads the proposal.

const DISCOVERY_TOOLS: Anthropic.Messages.ToolUnion[] = [
  // Basic web_search (not the _20260209 variant): its built-in "dynamic
  // filtering" spins up server-side code_execution to pre-filter results,
  // which tripled latency (~35s -> ~175s in an A/B) for no quality gain on
  // "restaurants near X". Cap rounds too — uncapped the model searches many
  // times. 3 is plenty and keeps latency sane.
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  {
    name: "propose_restaurants",
    description: "Return the final shortlist of restaurant suggestions.",
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
                  "Rough price feel as text (e.g. 'mid-range'). Never an exact price.",
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

const DISCOVERY_SYSTEM =
  "You help a couple find restaurants for a trip. Never ask the user questions " +
  "or reply conversationally — you cannot receive a reply. On every request you " +
  "MUST: (1) use the web_search tool to find real, currently-open restaurants " +
  "near the destination, then (2) call propose_restaurants with 3 to 4 options. " +
  "If their preferences are sparse, search for well-regarded, broadly-appealing " +
  "restaurants for that destination anyway — do not ask for more detail. Every " +
  "suggestion must come from a real search result and include that result's URL " +
  "as sourceUrl. Never invent a restaurant, a URL, or an exact price. Keep each " +
  "'why' to one sentence. When choosing, weight what they are in the mood for " +
  "right now first, then this trip's vibe and brief, then the couple's general " +
  "tastes. If told they are on foot, only propose places genuinely within " +
  "walking distance of the given anchor — never somewhere that needs a car or a " +
  "long ride."

function discoveryPrompt(query: RestaurantQuery): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const anchor = query.near || query.destination
  const tripLines = [
    list("This trip's vibe", query.trip.vibe),
    query.trip.brief ? `Trip brief: ${query.trip.brief}.` : "",
  ].filter(Boolean)
  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    query.craving ? `Right now they are in the mood for: ${query.craving}.` : "",
    query.walkable
      ? `They are on foot — only suggest places within easy walking distance of ${anchor}.`
      : query.near
        ? `Prefer places near ${query.near}.`
        : "",
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

/** Real web-search-backed restaurant shortlist for a trip. Returns [] if the
 * model finishes without proposing. */
export async function searchRestaurants(
  query: RestaurantQuery,
): Promise<RestaurantSuggestion[]> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: discoveryPrompt(query) },
  ]

  // Bounded loop only to resume the server-side search loop on pause_turn.
  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: DISCOVERY_SYSTEM,
      tools: DISCOVERY_TOOLS,
      messages,
    })

    const proposal = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_restaurants",
    )
    if (proposal) {
      const input = proposal.input as { suggestions?: RestaurantSuggestion[] }
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
