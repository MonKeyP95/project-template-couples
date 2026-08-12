/** Normalize a typed time to "HH:MM": "18" -> "18:00", "9:5" -> "09:05".
 * Leaves blanks and unrecognized input untouched. */
export function normalizeTime(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  const m = v.match(/^(\d{1,2})(?::?(\d{1,2}))?$/)
  if (!m) return v
  return `${m[1].padStart(2, "0")}:${(m[2] ?? "0").padStart(2, "0")}`
}
