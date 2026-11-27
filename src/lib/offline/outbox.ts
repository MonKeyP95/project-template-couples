import * as React from "react"

import type {
  AddNoteInput,
  AddTodayEventInput,
  LogExpenseInput,
} from "@/lib/trips/actions"

type Base = { id: string; queuedAt: string; failed?: string }

/** An on-the-road add that could not reach the server, kept on the phone. */
export type OutboxItem =
  | (Base & { kind: "expense"; input: LogExpenseInput })
  | (Base & { kind: "note"; input: AddNoteInput })
  | (Base & { kind: "event"; input: AddTodayEventInput })

export type OutboxKind = OutboxItem["kind"]
export type OutboxItemOf<K extends OutboxKind> = Extract<OutboxItem, { kind: K }>

const KEY = "together-outbox"
const EMPTY: OutboxItem[] = []

let lastRaw: string | null = null
let lastItems: OutboxItem[] = EMPTY

/** The outbox, as the same array until the stored text changes. */
export function readOutbox(): OutboxItem[] {
  const raw = localStorage.getItem(KEY)
  if (raw !== lastRaw) {
    lastRaw = raw
    lastItems = raw ? JSON.parse(raw) : EMPTY
  }
  return lastItems
}

function write(items: OutboxItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(KEY))
}

export function enqueue(item: OutboxItem): void {
  write([...readOutbox().filter((i) => i.id !== item.id), item])
}

export function removeItem(id: string): void {
  write(readOutbox().filter((i) => i.id !== id))
}

export function markFailed(id: string, message: string): void {
  write(readOutbox().map((i) => (i.id === id ? { ...i, failed: message } : i)))
}

function subscribe(onChange: () => void) {
  window.addEventListener(KEY, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(KEY, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Live list of one kind of waiting add; empty during server render. */
export function useOutbox<K extends OutboxKind>(kind: K): OutboxItemOf<K>[] {
  const all = React.useSyncExternalStore(subscribe, readOutbox, () => EMPTY)
  return React.useMemo(
    () => all.filter((i): i is OutboxItemOf<K> => i.kind === kind),
    [all, kind],
  )
}
