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

/** Sends now; a network failure (a throw, not an `{ error }`) queues it instead. */
export async function submitOrQueue(
  item: OutboxItem,
): Promise<{ error?: string; queued?: boolean }> {
  try {
    return await sendItem(item)
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
