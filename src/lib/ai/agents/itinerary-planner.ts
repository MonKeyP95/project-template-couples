import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"

/**
 * The itinerary planner AI. Suggests new, grounded ideas around what the
 * couple already planned via the forced propose_ideas tool, or returns one
 * clarifying question when the input is too thin. It never writes an event:
 * every idea becomes a suggestion the couple picks or dismisses.
 * Edit `system`/`tools`/`mcpServers` to change it.
 */

export interface DraftedIdea {
  /** big = an activity worth comparing options for; small = eat/drink. */
  kind: "big" | "small"
  /** One of the itinerary categories, e.g. Activities, Food. */
  category: string
  /** Short, e.g. "Kayak trip". */
  title: string
  /** The exact itinerary location name, or "". */
  place: string
  /** Day number 1..N; 0 = no preference. */
  day: number
  /** One line on why it suits them. */
  why: string
}

export interface ItineraryDraftContext {
  destination: string
  /** Day 1's date on a dated trip; null on a dream. Context only. */
  startDate: string | null
  dayCount: number
  /** Each place's days; `label` reads them as dates on a dated trip. */
  locations: { name: string; first: number; last: number; label: string }[]
  brief: string
  /** The trip's own answers: where they sleep, getting around, doing, eating. */
  prefs: string
  freeText: string
  /** What they do not want. A constraint, not a preference. */
  avoid: string
  /** What the couple already chose in the guided walk; ideas go around these,
   * never repeat them. */
  knownPlans: { category: string; place: string; subject: string; when: string }[]
  profileBlock: string
  tasteDirective: string
}

function itineraryPrompt(c: ItineraryDraftContext): string {
  const days = (l: { first: number; last: number }) =>
    l.first === l.last ? `Day ${l.first}` : `Days ${l.first}-${l.last}`
  const places = c.locations.length
    ? c.locations
        .map((l) => `${l.name} (${days(l)}${c.startDate ? `, ${l.label}` : ""})`)
        .join("; ")
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
    `Suggest new ideas for a ${c.dayCount}-day trip to ${c.destination}; days are numbered 1..${c.dayCount}.`,
    c.startDate ? `Day 1 is ${c.startDate}.` : "There are no dates yet.",
    `Places in order: ${places}.`,
    known
      ? `Already planned by them (do not suggest these again; suggest around them): ${known}.`
      : "",
    c.brief ? `Trip brief: ${c.brief}.` : "",
    c.prefs ? `Their answers: ${c.prefs}.` : "",
    c.freeText ? `What they want, in their words: ${c.freeText}.` : "",
    c.avoid ? `Must avoid - do not suggest any of these: ${c.avoid}.` : "",
    c.profileBlock ? `Who they are (a lens, not a checklist): ${c.profileBlock}` : "",
    c.tasteDirective,
  ]
    .filter(Boolean)
    .join(" ")
}

const itineraryPlanner: AgentDescriptor<
  ItineraryDraftContext,
  { ideas: DraftedIdea[]; question: string }
> = {
  name: "itinerary-planner",
  model: "claude-sonnet-4-6",
  maxTokens: 2048,
  system:
    "You suggest ideas for a couple's or family's trip by calling propose_ideas. You only " +
    "suggest: the couple picks what they want. Never re-propose what they already planned. " +
    "Be SPARSE: about one big idea per place (an activity worth comparing options for) and " +
    "three to five small ideas in total (a place to eat or drink). Do not pad with generic " +
    "filler like 'explore the old town'. " +
    "GROUNDING: stay strictly on the specific place names given; never leap from a country " +
    "to a city the user did not name; never invent a place or date from the trip's name. " +
    "Set place to one of the exact place names given (or empty). Set day to a whole day " +
    "number inside that place's days only when the idea clearly belongs on that day, else 0. " +
    "Keep each title short and each why to one line. Weight the couple's taste as a lens, " +
    "never a checklist. Do not invent prices or booking details. " +
    "If what you were given is too thin or ambiguous to ground on — no usable place, or a " +
    "place name you cannot confidently locate or understand — do NOT guess: return an empty " +
    "ideas array and put ONE short, specific clarifying question in question (name what you " +
    "need, e.g. which town or region). Otherwise return your ideas and leave question empty.",
  tools: ["propose_ideas"],
  toolChoice: { type: "tool", name: "propose_ideas" },
  mcpServers: [],
  buildInput: (c) => itineraryPrompt(c),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_ideas",
    )
    if (!proposal) return { ideas: [], question: "" }
    const data = proposal.input as { ideas?: DraftedIdea[]; question?: string }
    return { ideas: data.ideas ?? [], question: data.question ?? "" }
  },
}

/** Real Claude ideas for the trip, OR an empty ideas array plus one
 * clarifying question when the input is too thin. */
export function draftItinerary(
  context: ItineraryDraftContext,
): Promise<{ ideas: DraftedIdea[]; question: string }> {
  return runAgent(itineraryPlanner, context)
}
