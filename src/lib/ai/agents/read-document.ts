import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { ReceiptFile } from "./read-receipt"
import type { DocumentReading } from "@/lib/trips/document-types"

/**
 * The document reader. Given a booking, confirmation, ticket or policy (photo
 * or PDF), returns its key details and dated entries via submit_document.
 * Edit `system`/`tools` to change it.
 */

const READ_DOCUMENT_SYSTEM =
  "You read travel documents for a couple's trip: bookings, confirmations, " +
  "tickets, rentals, insurance. Report only what is printed; never guess. Use " +
  "null for anything the document doesn't show. Give one entry per separate " +
  "leg or event, each on its own date: a return flight is two entries, a " +
  "multi-leg ticket one per leg. A continuous stay or rental is one entry " +
  "spanning check-in to check-out or pickup to return, with the check-in or " +
  "pickup time as startTime and the check-out or return time as endTime. A " +
  "document with no dates has no entries. The link is a web address printed " +
  "in the document, never invented. Always answer by calling submit_document."

// No toolChoice, as in read-receipt: forced tool choice is rejected by the
// newest models, so a reply without the tool fails the read.
const readDocument: AgentDescriptor<ReceiptFile, DocumentReading> = {
  name: "read-document",
  model: "claude-haiku-5-5",
  maxTokens: 4096,
  system: READ_DOCUMENT_SYSTEM,
  tools: ["submit_document"],
  mcpServers: [],
  buildInput: (file) => [
    {
      role: "user",
      content: [
        file.mimeType === "application/pdf"
          ? {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: file.base64 },
            }
          : {
              type: "image",
              source: { type: "base64", media_type: file.mimeType, data: file.base64 },
            },
        { type: "text", text: "Read this document." },
      ],
    },
  ],
  parseOutput: (message) => {
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "submit_document",
    )
    if (!block) throw new Error("No document reading returned")
    return block.input as DocumentReading
  },
}

/** Read one document file. Throws when the model returns no reading. */
export function readDocumentFile(file: ReceiptFile): Promise<DocumentReading> {
  return runAgent(readDocument, file)
}
