/**
 * Mock for the trip chat. Pure, no network. This is the seam where a real LLM
 * lands later: keep ChatMessage stable, then turn requestChatReply into a
 * fetch('/api/chat', ...) (or have a route call the SDK). `context` is reserved
 * for trip facts the real model will use; the mock ignores it.
 */

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const TYPING_DELAY_MS = 600

function lastUserQuestion(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content.trim()
  }
  return ""
}

/**
 * Returns an honest placeholder reply after a short delay so the UI exercises
 * its pending state. Deterministic: same input -> same reply.
 */
export function requestChatReply(
  messages: ChatMessage[],
  context?: string,
): Promise<string> {
  void context
  const question = lastUserQuestion(messages)
  const reply = question
    ? `I'm your trip assistant, but I'm not connected to a live model yet, so I can't really answer that. Once I'm wired up I'll help with: "${question}"`
    : "I'm your trip assistant. I'm not connected to a live model yet, so I can't answer for real — but ask away and you'll see how it'll work."
  return new Promise((resolve) => setTimeout(() => resolve(reply), TYPING_DELAY_MS))
}
