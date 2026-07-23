import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { Suggestion } from "../suggestion-types"

/**
 * The suggestion AI. Given a surface and its trip context (a prompt the caller
 * builds), proposes exactly one short, actionable suggestion via the forced
 * propose_suggestion tool. Suggest-only. Edit `system`/`tools`/`mcpServers` to
 * change it.
 */

const SUGGESTION_SYSTEM =
  "You are the in-app assistant for a couple planning and taking trips " +
  "together. Given a surface and its current trip context, propose exactly one " +
  "short, specific, actionable suggestion for that surface. Ground it in the " +
  "context provided; never invent facts (place names, dates, prices) not given. " +
  "Keep the body to one or two sentences. Return only the propose_suggestion tool."

const suggestion: AgentDescriptor<string, Suggestion> = {
  name: "suggestion",
  model: "claude-sonnet-4-6",
  maxTokens: 512,
  system: SUGGESTION_SYSTEM,
  tools: ["propose_suggestion"],
  toolChoice: { type: "tool", name: "propose_suggestion" },
  mcpServers: [],
  buildInput: (prompt) => prompt,
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_suggestion",
    )
    if (!proposal) throw new Error("No suggestion returned")
    const data = proposal.input as { label?: string; body?: string }
    return { label: data.label ?? "/ suggested", body: data.body ?? "" }
  },
}

/** One real suggestion for a surface, from a context prompt the caller builds.
 * Throws when the model returns no tool block. */
export function generateSuggestion(prompt: string): Promise<Suggestion> {
  return runAgent(suggestion, prompt)
}
