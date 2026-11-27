import { addNote, addTodayEvent, logExpense } from "@/lib/trips/actions"

import { enqueue, markFailed, readOutbox, removeItem, type OutboxItem } from "./outbox"

/** Calls the item's server action. Throws when the server can't be reached. */
export function sendItem(item: OutboxItem): Promise<{ error?: string }> {
  switch (item.kind) {
    case "expense":
      return logExpense(item.input)
    case "note":
      return addNote(item.input)
    case "event":
      return addTodayEvent(item.input)
  }
}

/** On one bar of signal a send can hang for minutes rather than fail. */
const SEND_TIMEOUT_MS = 10_000

/**
 * Sends now; a network failure (a throw, not an `{ error }`) or a send slower
 * than SEND_TIMEOUT_MS queues it instead. A slow send that lands later is
 * harmless: the resend carries the same id.
 */
export async function submitOrQueue(
  item: OutboxItem,
): Promise<{ error?: string; queued?: boolean }> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), SEND_TIMEOUT_MS),
  )
  try {
    return await Promise.race([sendItem(item), timeout])
  } catch {
    enqueue(item)
    return { queued: true }
  }
}

/** Sends every waiting item in order. Failures stay, marked. Returns how many sent. */
export async function flushOutbox(): Promise<number> {
  let sent = 0
  for (const item of readOutbox()) {
    try {
      const result = await sendItem(item)
      if (result.error) {
        markFailed(item.id, result.error)
      } else {
        removeItem(item.id)
        sent++
      }
    } catch {
      markFailed(item.id, "send failed")
    }
  }
  return sent
}
