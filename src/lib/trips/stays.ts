import type { ItineraryDay } from "./itinerary-types"

const CHECK_OUT = /\s*\(check out\)\s*$/i
const CHECK_IN = /\s*\(check in\)\s*$/i

/**
 * Where the couple sleeps on a given day, read off Accommodation events.
 * A check-in (or an unlabelled stay) holds until its matching check-out;
 * on a day with both, the check-out is applied first. Null when nowhere.
 */
export function stayFor(days: ItineraryDay[], dayIndex: number): string | null {
  let stay: string | null = null
  const upTo = days.filter((d) => d.dayIndex <= dayIndex).sort((a, b) => a.dayIndex - b.dayIndex)
  for (const day of upTo) {
    const stays = day.events.filter((e) => e.category === "Accommodation")
    for (const e of stays) {
      if (CHECK_OUT.test(e.text) && e.text.replace(CHECK_OUT, "") === stay) stay = null
    }
    for (const e of stays) {
      if (!CHECK_OUT.test(e.text)) stay = e.text.replace(CHECK_IN, "")
    }
  }
  return stay
}
