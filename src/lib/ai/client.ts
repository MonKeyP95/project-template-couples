import "server-only"
import Anthropic from "@anthropic-ai/sdk"

/**
 * The single Anthropic client (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser.
 */
export const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from process.env
