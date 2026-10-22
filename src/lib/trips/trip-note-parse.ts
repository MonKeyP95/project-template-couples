/** Pattern-matching reader for the new-trip note ("10 days in Portugal, 1500
 * eur"). Pure and import-free so the form can run it on every keystroke. */

export interface NoteReading {
  /** 0 when the note names no length. */
  days: number
  /** Whole currency units; 0 when not found. */
  budget: number
  place: string
  what: string
}

export type PrefKey = "stay" | "move" | "acts" | "food" | "avoid"

export const PREF_TOPICS: {
  key: PrefKey
  label: string
  title: string
  hint: string
}[] = [
  { key: "stay", label: "Sleeping", title: "Where will you sleep?", hint: "Camping, or that surf hostel in Ericeira we saw..." },
  { key: "move", label: "Getting around", title: "How will you get around?", hint: "Rent a van, trains between towns..." },
  { key: "acts", label: "Doing", title: "What will you do?", hint: "Surf lessons in the mornings, one day in Lisbon..." },
  { key: "food", label: "Eating", title: "Groceries or eating out?", hint: "Mostly cooking, one nice dinner out..." },
  { key: "avoid", label: "Avoid", title: "Anything to avoid?", hint: "Crowded beaches, long drives..." },
]

const PREF_PATTERNS: Record<PrefKey, RegExp> = {
  stay: /camp|hostel|apartment|airbnb|hotel|guest ?house|villa|stay/i,
  move: /\bcar\b|\bvan\b|road ?trip|drive|train|\bbus\b|bike|cycl|fly|flight/i,
  acts: /surf|hik(e|ing)|trek|ski|div(e|ing)|snorkel|beach|museum|culture|party|nightlife|yoga/i,
  food: /cook|groceries|supermarket|restaurant|eat/i,
  avoid: /avoid|\bno\b|\bnot\b|hate/i,
}

const ACTIVITIES: [RegExp, string][] = [
  [/surf/i, "Surfing"], [/hik(e|ing)|trek/i, "Hiking"], [/ski/i, "Skiing"],
  [/div(e|ing)|snorkel/i, "Diving"], [/beach/i, "Beach"], [/food|eat(ing)? well/i, "Food"],
  [/museum|culture|history/i, "Culture"], [/road ?trip/i, "Road trip"],
  [/party|nightlife/i, "Nightlife"],
]

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
}
const UNIT_DAYS: Record<string, number> = { day: 1, night: 1, week: 7, month: 30 }

const NOT_PLACES =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)$/i

function parseDays(t: string): number {
  if (/fortnight/i.test(t)) return 14
  if (/long weekend/i.test(t)) return 3
  if (/weekend/i.test(t)) return 2
  const m = t.match(
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few)\s*(day|night|week|month)s?\b/i,
  )
  if (!m) return 0
  const n = /^\d+$/.test(m[1])
    ? parseInt(m[1], 10)
    : WORD_NUM[m[1].toLowerCase().replace(" of", "")]
  return n * UNIT_DAYS[m[2].toLowerCase()]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseBudget(t: string, code: string, symbol: string): number {
  const marks = [escapeRe(symbol), `${code}\\b`]
  if (code.toUpperCase() === "EUR") marks.push("euros?\\b")
  const mark = `(?:${marks.join("|")})`
  const num = "(\\d[\\d,.]*)\\s*(k)?"
  const m =
    t.match(new RegExp(`${mark}\\s*${num}`, "i")) ??
    t.match(new RegExp(`${num}\\s*${mark}`, "i")) ??
    t.match(new RegExp(`budget(?: of| is)?\\s*${num}(?![\\d\\s]*[a-z$€£¥])`, "i"))
  if (!m) return 0
  const n = parseFloat(m[1].replace(/,/g, ""))
  return Math.round(m[2] ? n * 1000 : n)
}

function parseWhere(t: string): string {
  const m = t.match(
    /\b(?:in|to|around|across)\s+(?:the\s+)?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*)/,
  )
  if (!m || NOT_PLACES.test(m[1])) return ""
  return m[1]
}

function parseWhat(t: string): string {
  return ACTIVITIES.find(([re]) => re.test(t))?.[1] ?? ""
}

export function readNote(text: string, code: string, symbol: string): NoteReading {
  return {
    days: parseDays(text),
    budget: parseBudget(text, code, symbol),
    place: parseWhere(text),
    what: parseWhat(text),
  }
}

/** Each preference gets the note's clauses that mention it. */
export function prefillPrefs(text: string): Record<PrefKey, string> {
  const parts = text
    .split(/[,.;]|\band\b/i)
    .map((p) => p.trim())
    .filter(Boolean)
  const pick = (key: PrefKey) =>
    parts.filter((p) => PREF_PATTERNS[key].test(p)).join(", ")
  return {
    stay: pick("stay"),
    move: pick("move"),
    acts: pick("acts"),
    food: pick("food"),
    avoid: pick("avoid"),
  }
}

export function tripHeadline(what: string, place: string): string {
  const w = what.trim()
  const p = place.trim()
  const line = w && p ? `${w} in ${p}` : w || p || "A trip"
  return line.charAt(0).toUpperCase() + line.slice(1)
}
