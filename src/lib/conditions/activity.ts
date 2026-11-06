export type Activity = "surf" | "dive"

const PATTERNS: [Activity, RegExp][] = [
  ["surf", /\b(surf|surfing)\b/i],
  ["dive", /\b(dive|diving|scuba)\b/i],
]

/** Every conditions activity a day's plan text names, surf first. Whole words
 * only, so "skydive" is not a dive. */
export function detectActivities(text: string): Activity[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([a]) => a)
}
