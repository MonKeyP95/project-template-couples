import "server-only"

import {
  getCoupleSummary,
  getTripSummary,
} from "@/lib/preferences/couple-summary-queries"
import type { LearnedCategory } from "@/lib/preferences/couple-summary-types"
import { listTripsForWorkspace, type TripListItem } from "@/lib/trips/list-queries"
import { localToday } from "@/lib/time/local-today"

const CATEGORIES: LearnedCategory[] = ["food", "activity", "accommodation", "transport"]

/** Past trips read for a home idea: the most recent few, so the prompt stays
 * the same size however many trips pile up. */
export const RECENT_PAST_TRIPS = 5

function tripLine(t: TripListItem): string {
  const where = t.country ? `${t.name} (${t.country})` : t.name
  const when = t.startDate
    ? ` ${t.startDate}${t.endDate && t.endDate !== t.startDate ? ` to ${t.endDate}` : ""}`
    : ""
  return `${where}${when}`
}

/** Everything a home idea is built from except today's date and the profile
 * block: what they asked for, their trips and dreams (so the idea doesn't
 * repeat one) and what was learned on them. Stable while nothing changes, so
 * it is also what the saved idea's fingerprint hashes. */
export async function buildHomeContext(
  workspaceId: string,
  ask: string | null,
): Promise<string> {
  const b = await listTripsForWorkspace(workspaceId)
  const known = (list: TripListItem[]) => list.map(tripLine).join("; ")
  const learned = await buildLearnedFromTrips(workspaceId, b.past)
  return [
    ask ? `What they asked for: "${ask}".` : "They asked for any new trip idea.",
    b.past.length ? `Past trips: ${known(b.past)}.` : "No past trips in the app yet.",
    `Planned and dreamed: ${known([...b.now, ...b.upcoming, ...b.dreams]) || "none"}.`,
    learned ? `Learned from their trips: ${learned}` : null,
  ]
    .filter(Boolean)
    .join(" ")
}

/** The home context with today's date in front, for seasons. How to pick
 * lives in the trip-idea agent's system prompt. */
export async function buildHomeIdeaPrompt(
  workspaceId: string,
  ask: string | null,
): Promise<string> {
  return `Today is ${await localToday()}. ${await buildHomeContext(workspaceId, ask)}`
}

/** What the app has already learned, as stored text: the couple's stay and
 * transport summaries (food and activity already come with the profile) and
 * each recent past trip's own summaries. Reads only; generates nothing. */
export async function buildLearnedFromTrips(
  workspaceId: string,
  pastTrips: TripListItem[],
): Promise<string> {
  const parts: string[] = []
  for (const category of ["accommodation", "transport"] as const) {
    const s = (await getCoupleSummary(workspaceId, category)).summaryMd.trim()
    if (s) parts.push(`Learned about their ${category} taste: ${s}`)
  }
  for (const trip of pastTrips.slice(0, RECENT_PAST_TRIPS)) {
    const lines = await tripLearnings(trip.id)
    if (lines) parts.push(`What they liked on ${trip.name}: ${lines}`)
  }
  return parts.join(" ")
}

/** One past trip's stored summaries joined into a line, or "" when none. */
async function tripLearnings(tripId: string): Promise<string> {
  const summaries = await Promise.all(
    CATEGORIES.map(async (c) => {
      const s = (await getTripSummary(tripId, c)).summaryMd.trim()
      return s ? `${c}: ${s}` : ""
    }),
  )
  return summaries.filter(Boolean).join(" ")
}
