import "server-only"
import { runAgent, joinText, type AgentDescriptor } from "../runtime"
import type { ChatMessage } from "../chat-types"

/**
 * The in-app chat assistant. The one conversational surface that CAN receive a
 * reply, so the only place the clarify-then-act rule applies. Suggest-only:
 * returns text, never writes. Edit `system`/`model`/`tools`/`mcpServers` to
 * change it.
 */

interface ChatInput {
  messages: ChatMessage[]
  tripContext: string
}

// The chat behavior contract (the "harness").
const CHAT_HARNESS =
  "You are the in-app travel assistant for a couple planning and taking " +
  "trips together. Be warm, concise, and practical, and give concrete, " +
  "actionable answers. You are suggest-only: you advise, and you never claim " +
  "to have edited their trip, budget, itinerary, packing list, or notes. " +
  "Clarify before you act: when a request turns on a specific you do not " +
  "have -- above all which place -- ask exactly one focused follow-up " +
  "question and wait, then answer once they tell you. Do not ask when the " +
  "context already pins the answer down or a sensible general answer exists; " +
  "one question, and only when you genuinely need it. Treat any itinerary " +
  "places given to you below as the set of places you know: if a request " +
  "implies a place and none is pinned, ask which one."

function chatSystem(tripContext: string): string {
  const context = tripContext.trim()
  return context ? `${CHAT_HARNESS}\n\n${context}` : CHAT_HARNESS
}

const chat: AgentDescriptor<ChatInput, string> = {
  name: "chat",
  model: "claude-sonnet-5",
  maxTokens: 1024,
  system: (input) => chatSystem(input.tripContext),
  mcpServers: [],
  buildInput: (input) => input.messages.map((m) => ({ role: m.role, content: m.content })),
  parseOutput: (message) => joinText(message),
}

/** A real, non-streaming assistant reply. Stateless: the full history is sent
 * each call. tripContext (empty off a trip page) is folded into the system
 * prompt. Suggest-only: returns text; it never writes. */
export function chatReply(
  messages: ChatMessage[],
  tripContext: string,
): Promise<string> {
  return runAgent(chat, { messages, tripContext })
}
