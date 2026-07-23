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
    "Set place to one of the exact place names given (or empty). Set date to a real " +
    "YYYY-MM-DD within range, or empty if you cannot place it. Keep each event a short " +
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
