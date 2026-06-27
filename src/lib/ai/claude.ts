import "server-only"
import Anthropic from "@anthropic-ai/sdk"

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
