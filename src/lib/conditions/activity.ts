export type Activity = "surf" | "dive"

const PATTERNS: [Activity, RegExp][] = [
  ["surf", /\b(surf|surfing)\b/i],
  ["dive", /\b(dive|diving|scuba)\b/i],
]

/** The conditions activity a day's plan text names, or null. Whole words only,
 * so "skydive" is not a dive. Surf wins if both appear. */
export function detectActivity(text: string): Activity | null {
  for (const [activity, pattern] of PATTERNS) {
    if (pattern.test(text)) return activity
  }
  return null
}
