import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { ReceiptMime, ReceiptReading } from "@/lib/trips/receipt-types"

/**
 * The receipt reader. Given one receipt photo or PDF, returns what it shows via
 * the submit_receipt tool. Read-only: the result is shown next to an expense,
 * never written into it. Edit `system`/`tools` to change it.
 */

export interface ReceiptFile {
  base64: string
  mimeType: ReceiptMime
}

const READ_RECEIPT_SYSTEM =
  "You read receipts, invoices and booking confirmations for a couple's trip " +
  "budget. Report only what is printed; never guess. Use null for anything the " +
  "document doesn't show. Give the currency only when a symbol, code or the " +
  "shop's country makes it clear. Amounts are integers in hundredths of the " +
  "currency. The summary is one short line naming what was bought and where. " +
  "Always answer by calling submit_receipt."

// No toolChoice: the newest models reject a forced tool choice, so the system
// prompt asks for the tool and parseOutput fails the read when it's missing.
const readReceipt: AgentDescriptor<ReceiptFile, ReceiptReading> = {
  name: "read-receipt",
  model: "claude-haiku-5-5",
  maxTokens: 4096,
  system: READ_RECEIPT_SYSTEM,
  tools: ["submit_receipt"],
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
        { type: "text", text: "Read this receipt." },
      ],
    },
  ],
  parseOutput: (message) => {
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "submit_receipt",
    )
    if (!block) throw new Error("No receipt reading returned")
    return block.input as ReceiptReading
  },
}

/** Read one receipt file. Throws when the model returns no reading. */
export function readReceiptFile(file: ReceiptFile): Promise<ReceiptReading> {
  return runAgent(readReceipt, file)
}
