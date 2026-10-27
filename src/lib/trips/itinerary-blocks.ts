import type { ItineraryEvent } from "./itinerary-types"

/** A day as block editing sees it: its headline and events. */
export interface BlockDay {
  title: string
  events: ItineraryEvent[]
}

/** One event change from the block editor: edited (both set), added (no
 * `old`) or removed (no `next`). */
export interface BlockEventEdit {
  old: ItineraryEvent | null
  next: ItineraryEvent | null
}

export interface BlockEdit {
  oldTitle: string
  newTitle: string
  events: BlockEventEdit[]
}

const PLAN_FIELDS = ["time", "endTime", "text", "url", "details", "category"] as const

/** Same planned event: equal on the plan fields, missing == "". Rating and
 * note are per-day feedback and never count. */
export function samePlan(a: ItineraryEvent, b: ItineraryEvent): boolean {
  return PLAN_FIELDS.every((f) => (a[f] ?? "") === (b[f] ?? ""))
}

function stripFeedback(e: ItineraryEvent): ItineraryEvent {
  const plan = { ...e }
  delete plan.rating
  delete plan.note
  return plan
}

/** The block's shared part, derived from its days: events found on at least
 * 2 days and at least half of them, and the most common headline. */
export function blockTemplate(days: BlockDay[]): BlockDay {
  const counted: { event: ItineraryEvent; count: number }[] = []
  for (const day of days) {
    const seen: ItineraryEvent[] = []
    for (const e of day.events) {
      if (seen.some((s) => samePlan(s, e))) continue
      seen.push(e)
      const hit = counted.find((c) => samePlan(c.event, e))
      if (hit) hit.count++
      else counted.push({ event: stripFeedback(e), count: 1 })
    }
  }
  const need = Math.max(2, Math.ceil(days.length / 2))
  return {
    title: mostCommon(days.map((d) => d.title)),
    events: counted.filter((c) => c.count >= need).map((c) => c.event),
  }
}

function mostCommon(values: string[]): string {
  let best = values[0] ?? ""
  let bestCount = 0
  for (const v of values) {
    const count = values.filter((x) => x === v).length
    if (count > bestCount) {
      best = v
      bestCount = count
    }
  }
  return best
}

/** Apply a block edit to one day. Events no longer matching the old shared
 * version were hand-edited on this day and are left alone. */
export function applyBlockEdit(day: BlockDay, edit: BlockEdit): BlockDay {
  let events = day.events
  for (const { old, next } of edit.events) {
    if (old && next) {
      const i = events.findIndex((e) => samePlan(e, old))
      if (i === -1) continue
      const { rating, note } = events[i]
      const merged = {
        ...stripFeedback(next),
        ...(rating !== undefined ? { rating } : {}),
        ...(note !== undefined ? { note } : {}),
      }
      events = events.map((e, j) => (j === i ? merged : e))
    } else if (next) {
      if (!events.some((e) => samePlan(e, next))) events = [...events, next]
    } else if (old) {
      const i = events.findIndex((e) => samePlan(e, old))
      if (i !== -1) events = events.filter((_, j) => j !== i)
    }
  }
  return {
    ...day,
    title: day.title === edit.oldTitle ? edit.newTitle : day.title,
    events,
  }
}

/** Runs of a group's days left after `removed` leave it. Days are walked in
 * date order; any other day in between breaks a run. */
export function leftoverRuns(
  sortedDays: { id: string; groupId: string | null }[],
  groupId: string,
  removed: Set<string>,
): string[][] {
  const runs: string[][] = []
  let run: string[] = []
  for (const day of sortedDays) {
    if (day.groupId === groupId && !removed.has(day.id)) {
      run.push(day.id)
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)
  return runs
}
