import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"

/**
 * The itinerary planner AI. Drafts a sparse, grounded itinerary via the forced
 * propose_itinerary tool, or returns one clarifying question when the input is
 * too thin. Suggest-only. Edit `system`/`tools`/`mcpServers` to change it.
 */

export interface DraftedItineraryEvent {
  /** One of: Activities, Food, Transportation. */
  category: string
  /** The exact itinerary location name this event belongs to. */
  place: string
  /** Short label, e.g. "Surf lesson at the point" or "Dinner - seafood". */
  text: string
  /** Day number 1..N within the trip; 0 when the model could not place it. */
  day: number
  /** HH:MM, may be empty. */
  time: string
}

export interface ItineraryDraftContext {
  destination: string
  /** Day 1's date on a dated trip; null on a dream. Context only. */
  startDate: string | null
  dayCount: number
  /** Each place's days; `label` reads them as dates on a dated trip. */
  locations: { name: string; first: number; last: number; label: string }[]
  vibe: string[]
  brief: string
  /** The trip's own answers: where they sleep, getting around, doing, eating. */
  prefs: string
  activityTypes: string[]
  freeText: string
  /** What they do not want. A constraint, not a preference. */
  avoid: string
  /** What the couple already chose in the guided walk; the itinerary is built
   * around these, then gaps filled sparsely. */
  knownPlans: { category: string; place: string; subject: string; when: string }[]
  profileBlock: string
  tasteDirective: string
}

function itineraryPrompt(c: ItineraryDraftContext): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
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
    `Draft a ${c.dayCount}-day itinerary for ${c.destination}; days are numbered 1..${c.dayCount}.`,
    c.startDate ? `Day 1 is ${c.startDate}.` : "There are no dates yet.",
    `Places in order: ${places}.`,
    known
      ? `Plans they already chose (include each of these in the itinerary, on the days or nights they gave, then fill the gaps sparsely): ${known}.`
      : "",
    list("Trip vibe", c.vibe),
    c.brief ? `Trip brief: ${c.brief}.` : "",
    c.prefs ? `Their answers: ${c.prefs}.` : "",
    list("Activity types they want", c.activityTypes),
    c.freeText ? `They also said: ${c.freeText}.` : "",
    c.avoid ? `Must avoid - do not include any of these: ${c.avoid}.` : "",
    c.profileBlock ? `Who they are (a lens, not a checklist): ${c.profileBlock}` : "",
    c.tasteDirective,
  ]
    .filter(Boolean)
    .join(" ")
}

const itineraryPlanner: AgentDescriptor<
  ItineraryDraftContext,
  { events: DraftedItineraryEvent[]; question: string }
> = {
  name: "itinerary-planner",
  model: "claude-sonnet-4-6",
  maxTokens: 2048,
  system:
    "You draft a trip itinerary for a couple or family by calling propose_itinerary. " +
    "Be SPARSE: propose only a few genuinely grounded items per category (roughly one " +
    "or two), and leave a category empty if you have nothing concrete. Do not pad with " +
    "generic filler like 'explore the old town'. Leave room for the user to fill the rest. " +
    "GROUNDING: stay strictly on the specific place names given; never leap from a country " +
    "to a city the user did not name; never invent a place or date from the trip's name. " +
    "Set place to one of the exact place names given (or empty). Set day to a whole day " +
    "number within 1..N inside that place's days, or 0 if you cannot place it. Keep each event a short " +
    "label, not a paragraph. Weight the couple's taste and vibe as a lens, never a checklist. " +
    "Do not invent prices or booking details. " +
    "If what you were given is too thin or ambiguous to ground on — no usable place, or a " +
    "place name you cannot confidently locate or understand — do NOT guess: return an empty " +
    "events array and put ONE short, specific clarifying question in question (name what you " +
    "need, e.g. which town or region). Otherwise return your events and leave question empty.",
  tools: ["propose_itinerary"],
  toolChoice: { type: "tool", name: "propose_itinerary" },
  mcpServers: [],
  buildInput: (c) => itineraryPrompt(c),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_itinerary",
    )
    if (!proposal) return { events: [], question: "" }
    const data = proposal.input as { events?: DraftedItineraryEvent[]; question?: string }
    return { events: data.events ?? [], question: data.question ?? "" }
  },
}

/** Real Claude itinerary draft. Returns sparse, grounded events, OR an empty
 * events array plus one clarifying question when the input is too thin. */
export function draftItinerary(
  context: ItineraryDraftContext,
): Promise<{ events: DraftedItineraryEvent[]; question: string }> {
  return runAgent(itineraryPlanner, context)
}
