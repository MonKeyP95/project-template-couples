/** Turns the itinerary walk's entries, or the dream planner's drafted events,
 * into dream day cards: one card per empty day, never touching a filled one.
 * The day-number twin of entriesToSkeleton / itemsToSkeleton. Import-free. */

export interface DreamPlanItem {
  category: string
  place: string
  text: string
  /** 1-based day; 0 = not placed yet. */
  day: number
}

export interface DreamCardDraft {
  dayIndex: number
  tag: string
  title: string
  sub: string
  tone: "sea" | "clay" | "moss" | "sand"
}

export interface DaySpan {
  name: string
  first: number
  last: number
}

const BRACKET_LABELS: Record<string, [string, string]> = {
  Accommodation: ["check in", "check out"],
  Transportation: ["pick up", "drop off"],
}

const TITLE_PRIORITY = ["Activities", "Food", "Accommodation", "Transportation", "Other"]

const TONES: Record<string, DreamCardDraft["tone"]> = {
  Accommodation: "sand",
  Food: "clay",
  Activities: "sea",
  Transportation: "moss",
  Other: "sand",
}

/** Even split of days 1..dayCount across the places, remainder to the earlier
 * ones - the same rule planItinerarySkeleton uses for dates. */
export function splitDays(dayCount: number, places: string[], fallback: string): DaySpan[] {
  const names = places.map((p) => p.trim()).filter(Boolean)
  const list = names.length > 0 ? names : [fallback.trim() || "Trip"]
  const base = Math.floor(dayCount / list.length)
  const extra = dayCount % list.length
  let next = 1
  return list.map((name, i) => {
    const count = base + (i < extra ? 1 : 0)
    const span = { name, first: next, last: next + count - 1 }
    next += count
    return span
  })
}

function clamp(day: number, dayCount: number): number {
  return Math.min(Math.max(day, 1), dayCount)
}

/** The days one walk entry lands on. `date`/`endDate` carry day numbers. A
 * stay or transport range brackets its two ends; anything else repeats. */
export function entryItems(
  e: { category: string; place: string; subject: string; date?: string; endDate?: string },
  dayCount: number,
): DreamPlanItem[] {
  const text = e.subject.trim() || e.category
  const item = (day: number, label = ""): DreamPlanItem => ({
    category: e.category,
    place: e.place,
    text: label ? `${text} (${label})` : text,
    day,
  })
  const start = parseInt(e.date ?? "", 10) || 0
  if (!start) return [item(0)]
  const end = parseInt(e.endDate ?? "", 10) || 0
  if (!end || end <= start) return [item(clamp(start, dayCount))]
  const labels = BRACKET_LABELS[e.category]
  if (labels) {
    return [item(clamp(start, dayCount), labels[0]), item(clamp(end, dayCount), labels[1])]
  }
  const out: DreamPlanItem[] = []
  for (let d = clamp(start, dayCount); d <= clamp(end, dayCount); d++) out.push(item(d))
  return out
}

/** Unplaced or out-of-range items go to the first empty day of their place's
 * span; items on a filled day are dropped. */
export function placeItems(
  items: DreamPlanItem[],
  spans: DaySpan[],
  filled: Set<number>,
): DreamPlanItem[] {
  const last = spans[spans.length - 1]?.last ?? 0
  const out: DreamPlanItem[] = []
  for (const item of items) {
    let day = item.day
    if (day < 1 || day > last) {
      const key = item.place.trim().toLowerCase()
      const span = spans.find((s) => s.name.toLowerCase() === key) ?? spans[0]
      day = 0
      for (let d = span.first; d <= span.last; d++) {
        if (!filled.has(d)) {
          day = d
          break
        }
      }
    }
    if (day && !filled.has(day)) out.push({ ...item, day })
  }
  return out
}

function rank(category: string): number {
  const i = TITLE_PRIORITY.indexOf(category)
  return i < 0 ? TITLE_PRIORITY.length : i
}

/** One card per empty day: titled by what you'll do first, the rest in sub. */
export function buildCards(
  items: DreamPlanItem[],
  filled: Set<number>,
  tripPlace: string,
): DreamCardDraft[] {
  const byDay = new Map<number, DreamPlanItem[]>()
  for (const item of items) {
    if (item.day < 1 || filled.has(item.day)) continue
    byDay.set(item.day, [...(byDay.get(item.day) ?? []), item])
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => {
      const [head, ...rest] = [...list].sort((a, b) => rank(a.category) - rank(b.category))
      return {
        dayIndex: day,
        tag: head.place.trim() || tripPlace,
        title: head.text,
        sub: rest.map((r) => r.text).join(" · "),
        tone: TONES[head.category] ?? "sand",
      }
    })
}

/** The places a dream was planned with, read back from its card tags. */
export function placesFromCards(cards: { dayIndex: number; tag: string }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of [...cards].sort((a, b) => a.dayIndex - b.dayIndex)) {
    const key = c.tag.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(c.tag.trim())
  }
  return out
}

/** Renumber positions to 1..k in order. Applied in this ascending order, each
 * target is already free, so the unique (trip, day_index) never collides. */
export function closeGaps(indices: number[]): { from: number; to: number }[] {
  return [...indices]
    .sort((a, b) => a - b)
    .map((from, i) => ({ from, to: i + 1 }))
    .filter((m) => m.from !== m.to)
}
