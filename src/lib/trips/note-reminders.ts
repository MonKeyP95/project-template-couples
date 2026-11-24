/** Note reminder rules and formatting. No server imports: safe in client components. */

type Remindable = { remindAt: string | null }

/** True once the note's reminder moment has passed and it is not done. */
export function isDue(note: Remindable, now: Date): boolean {
  return note.remindAt !== null && new Date(note.remindAt) <= now
}

export function hasDue(notes: Remindable[], now: Date): boolean {
  return notes.some((n) => isDue(n, now))
}

function parts(iso: string, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "18:00 · 25 Nov" in the given timezone. */
export function reminderLabel(iso: string, tz: string): string {
  const p = parts(iso, tz)
  return `${p.hour}:${p.minute} · ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`
}

/** A `datetime-local` value ("yyyy-mm-ddThh:mm") in the given timezone; "" for none. */
export function toLocalInput(iso: string | null, tz: string): string {
  if (!iso) return ""
  const p = parts(iso, tz)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** A `datetime-local` value back to ISO, read in the browser's own timezone; "" is none. */
export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}
