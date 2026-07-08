/** Chat message shape shared by the client component and the server seam.
 * Kept provider-neutral (not an Anthropic type) so a future model/provider
 * swap only rewrites chatReply's body. Pure — safe to import from a client
 * component. */
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}
