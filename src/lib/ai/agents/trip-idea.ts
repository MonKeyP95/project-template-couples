import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { TripIdea } from "../suggestion-types"
import type { IdeaPlan } from "@/lib/trips/idea-route"

/**
 * The trip-idea AI behind the home page's assistant line. Given the couple's
 * profile, their existing trips and what they asked for, proposes new
 * destinations via propose_trip_ideas; the caller says how many. Suggest-only.
 * Unlike `suggestion`, naming a place that is not in the context is the point.
 * Edit `system`/`tools`/`mcpServers` to change it.
 */

const TRIP_IDEA_SYSTEM =
  "You suggest next trips for a couple who plan travel together. Each idea is " +
  "one real destination that fits them specifically: build it from the " +
  "concrete things the app has learned about them (what they liked on past " +
  "trips, activities they love, food they like, how they stay and travel, how " +
  "they describe themselves) and say which ones it answers, naming a past trip " +
  "when the pick builds on it. " +
  "Prefer a specific, less obvious pick over a generic famous one, and give it " +
  "a hook: a season, a route or one thing to do there. When asked for several, " +
  "make each its own direction and place. Never repeat a trip or dream they " +
  "already have. Do not invent prices or exact dates. If the profile is thin, " +
  "use what they asked for and their past trips. Never ask questions; you " +
  "cannot receive a reply. For each idea also fill plan: the same trip as " +
  "structured answers, with no dates and no prices. Return only the " +
  "propose_trip_ideas tool."

const MAX_IDEAS = 3

const EMPTY_PLAN = (place: string): IdeaPlan => ({
  place,
  what: "",
  days: 0,
  prefs: { stay: "", move: "", acts: "", food: "", avoid: "" },
  stops: [],
})

type Raw = { pill?: string; label?: string; body?: string; plan?: IdeaPlan }

function toIdea(raw: Raw): TripIdea {
  const label = raw.label ?? "/ idea"
  return {
    pill: raw.pill ?? label,
    label,
    body: raw.body ?? "",
    plan: raw.plan ?? EMPTY_PLAN(label),
  }
}

// No toolChoice, matching the other suggestion agents; the system prompt asks
// for the tool. maxTokens leaves room for thinking and three full plans.
const tripIdea: AgentDescriptor<{ prompt: string; count: number }, TripIdea[]> = {
  name: "trip-idea",
  model: "claude-haiku-5-5",
  maxTokens: 6000,
  system: TRIP_IDEA_SYSTEM,
  tools: ["propose_trip_ideas"],
  mcpServers: [],
  buildInput: ({ prompt, count }) =>
    `${prompt} Give exactly ${count} ${count === 1 ? "idea" : "ideas"}.`,
  parseOutput: (message) => {
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "propose_trip_ideas",
    )
    const ideas = ((block?.input as { ideas?: Raw[] } | undefined)?.ideas ?? [])
      .slice(0, MAX_IDEAS)
      .map(toIdea)
    if (!ideas.length) throw new Error("No trip idea returned")
    return ideas
  },
}

/** `count` new trip ideas (at most 3) from a context prompt the caller
 * builds. Throws when the model returns none. */
export function generateTripIdeas(prompt: string, count: number): Promise<TripIdea[]> {
  return runAgent(tripIdea, { prompt, count })
}
