import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"

/**
 * The dream itinerary planner AI: the itinerary planner for a trip with no
 * dates, whose days are numbered 1..N. Drafts sparse, grounded events via the
 * forced propose_dream_itinerary tool, or returns one clarifying question.
 * Suggest-only. Edit `system`/`tools`/`mcpServers` to change it.
 */

export interface DreamDraftedEvent {
  /** One of: Accommodation, Transportation, Activities, Food, Other. */
  category: string
  place: string
  text: string
  /** 1..N, or 0 when the model could not place it. */
  day: number
  time: string
}

export interface DreamDraftContext {
  destination: string
  dayCount: number
  places: { name: string; first: number; last: number }[]
  brief: string
  /** The trip's own answers: where they sleep, getting around, doing, eating. */
  prefs: string
  freeText: string
  avoid: string
  /** What they already chose, including days already filled ("Day 3: ..."). */
  knownPlans: string[]
  profileBlock: string
  tasteDirective: string
}

function dreamPrompt(c: DreamDraftContext): string {
  const places = c.places
    .map((p) => `${p.name} (${p.first === p.last ? `Day ${p.first}` : `Days ${p.first}-${p.last}`})`)
    .join("; ")
  return [
    `Draft a ${c.dayCount}-day itinerary for ${c.destination}; no dates yet, days are numbered 1..${c.dayCount}.`,
    `Places in order: ${places}.`,
    c.knownPlans.length
      ? `Plans they already chose (keep these; propose nothing for a day already planned): ${c.knownPlans.join("; ")}.`
      : "",
    c.brief ? `Trip brief: ${c.brief}.` : "",
    c.prefs ? `Their answers: ${c.prefs}.` : "",
    c.freeText ? `They also said: ${c.freeText}.` : "",
    c.avoid ? `Must avoid - do not include any of these: ${c.avoid}.` : "",
    c.profileBlock ? `Who they are (a lens, not a checklist): ${c.profileBlock}` : "",
    c.tasteDirective,
  ]
    .filter(Boolean)
    .join(" ")
}

const dreamItineraryPlanner: AgentDescriptor<
  DreamDraftContext,
  { events: DreamDraftedEvent[]; question: string }
> = {
  name: "dream-itinerary-planner",
  model: "claude-sonnet-4-6",
  maxTokens: 2048,
  system:
    "You draft a rough trip itinerary for a couple or family by calling propose_dream_itinerary. " +
    "The trip has no dates yet; its days are numbered 1..N. " +
    "Be SPARSE: propose only a few genuinely grounded items per category (roughly one " +
    "or two), and leave a category empty if you have nothing concrete. Do not pad with " +
    "generic filler like 'explore the old town'. Leave room for the user to fill the rest. " +
    "GROUNDING: stay strictly on the specific place names given; never leap from a country " +
    "to a city the user did not name; never invent a place from the trip's name. " +
    "Set place to one of the exact place names given (or empty). Set day to a whole day " +
    "number within 1..N inside that place's days, or 0 if you cannot place it. Several items " +
    "may share a day; the app turns each day into one short card. Days already planned are " +
    "listed as known plans - propose nothing for them. Keep each event a short label, not a " +
    "paragraph. Weight the couple's taste as a lens, never a checklist. " +
    "Do not invent prices or booking details. " +
    "If what you were given is too thin or ambiguous to ground on — no usable place, or a " +
    "place name you cannot confidently locate or understand — do NOT guess: return an empty " +
    "events array and put ONE short, specific clarifying question in question (name what you " +
    "need, e.g. which town or region). Otherwise return your events and leave question empty.",
  tools: ["propose_dream_itinerary"],
  toolChoice: { type: "tool", name: "propose_dream_itinerary" },
  mcpServers: [],
  buildInput: (c) => dreamPrompt(c),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_dream_itinerary",
    )
    if (!proposal) return { events: [], question: "" }
    const data = proposal.input as { events?: DreamDraftedEvent[]; question?: string }
    return { events: data.events ?? [], question: data.question ?? "" }
  },
}

/** Real Claude dream itinerary draft: sparse day-numbered events, OR no events
 * plus one clarifying question when the input is too thin. */
export function draftDreamItinerary(
  context: DreamDraftContext,
): Promise<{ events: DreamDraftedEvent[]; question: string }> {
  return runAgent(dreamItineraryPlanner, context)
}
