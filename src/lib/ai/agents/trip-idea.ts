import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { Suggestion } from "../suggestion-types"

/**
 * The trip-idea AI behind the home page's assistant line. Given the couple's
 * profile, their existing trips and what they asked for, proposes one new
 * destination via propose_trip_idea. Suggest-only. Unlike `suggestion`, naming
 * a place that is not in the context is the point. Edit `system`/`tools`/
 * `mcpServers` to change it.
 */

const TRIP_IDEA_SYSTEM =
  "You suggest the next trip for a couple who plan travel together. Pick one " +
  "real destination that fits them specifically: build it from the concrete " +
  "things the app has learned about them (what they liked on past trips, " +
  "activities they love, food they like, how they stay and travel, how they " +
  "describe themselves) and say which ones it answers, naming a past trip " +
  "when the pick builds on it. " +
  "Prefer a specific, less obvious pick over a generic famous one, and give it " +
  "a hook: a season, a route or one thing to do there. Never repeat a trip or " +
  "dream they already have. Do not invent prices or exact dates. If the " +
  "profile is thin, use what they asked for and their past trips. Never ask " +
  "questions; you cannot receive a reply. Return only the propose_trip_idea tool."

// No toolChoice, matching the other suggestion agents; the system prompt asks
// for the tool. maxTokens leaves room for thinking.
const tripIdea: AgentDescriptor<string, Suggestion> = {
  name: "trip-idea",
  model: "claude-haiku-5-5",
  maxTokens: 2048,
  system: TRIP_IDEA_SYSTEM,
  tools: ["propose_trip_idea"],
  mcpServers: [],
  buildInput: (prompt) => prompt,
  parseOutput: (message) => {
    const idea = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_trip_idea",
    )
    if (!idea) throw new Error("No trip idea returned")
    const data = idea.input as { label?: string; body?: string }
    return { label: data.label ?? "/ idea", body: data.body ?? "" }
  },
}

/** One new trip idea from a context prompt the caller builds. Throws when the
 * model returns no tool block. */
export function generateTripIdea(prompt: string): Promise<Suggestion> {
  return runAgent(tripIdea, prompt)
}
