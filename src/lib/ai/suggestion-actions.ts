"use server"

import { generateSuggestion } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { getPackingItems } from "@/lib/trips/packing-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripNotes } from "@/lib/trips/note-queries"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { listChecklists } from "@/lib/checklists/queries"
import { localToday } from "@/lib/time/local-today"
import type { SurfaceKey, Suggestion } from "@/lib/ai/suggestion-types"

const EUR = (cents: number) => `EUR ${Math.round(cents / 100)}`

/** Short "Name (Country) start to end" trip line. */
function tripLine(
  name: string,
  country: string | null,
  start: string | null,
  end: string | null,
): string {
  const where = country ? `${name} (${country})` : name
  const when = start ? ` ${start}${end && end !== start ? ` to ${end}` : ""}` : ""
  return `${where}${when}`
}

/** Build the per-surface context prompt. Returns null when required trip data
 * is missing (the caller turns that into a soft error). */
async function buildPrompt(
  surface: SurfaceKey,
  workspaceId: string,
  tripSlug: string | undefined,
): Promise<string | null> {
  // Workspace-level surfaces first (no tripSlug needed).
  if (surface === "home") {
    const buckets = await listTripsForWorkspace(workspaceId)
    const hero = buckets.now[0] ?? buckets.upcoming[0]
    if (!hero) {
      return "Surface: home. The couple is planning but has no active or upcoming trip yet. Suggest one first planning step (e.g. start a trip or a dream)."
    }
    return [
      "The couple is planning. Surface: home (the landing page).",
      `Their next trip: ${tripLine(hero.name, hero.country, hero.startDate, hero.endDate)}.`,
      "Suggest one concrete next planning step for that trip.",
    ].join(" ")
  }

  if (surface === "checklists") {
    const lists = await listChecklists(workspaceId)
    const names = lists.map((l) => `${l.name} (${l.done}/${l.total})`).join(", ")
    return [
      "The couple is preparing reusable packing checklists. Surface: checklists.",
      lists.length ? `Their checklists: ${names}.` : "They have no checklists yet.",
      "Suggest one useful checklist to create or an item they likely forgot.",
    ].join(" ")
  }

  // Trip-scoped surfaces require a slug + trip.
  if (!tripSlug) return null
  const trip = await getTripBySlug(workspaceId, tripSlug)
  if (!trip) return null
  const header = tripLine(trip.name, trip.country, trip.startDate, trip.endDate)

  if (surface === "budget") {
    const items = await getBudgetItems(trip.id)
    const lines = items
      .map((i) => `${i.category}: ${i.subject} ${EUR(i.amountCents)}`)
      .join("; ")
    return [
      `The couple is planning ${header}. Surface: budget.`,
      trip.plannedBudgetCents
        ? `Planned budget: ${EUR(trip.plannedBudgetCents)}.`
        : "No overall budget set yet.",
      items.length ? `Line items: ${lines}.` : "No budget line items yet.",
      "Suggest one budget gap, missing cost, or adjustment.",
    ].join(" ")
  }

  if (surface === "packing") {
    const items = await getPackingItems(trip.id)
    const labels = items.map((i) => i.label).join(", ")
    return [
      `The couple is planning ${header}. Surface: packing.`,
      items.length ? `Already on the list: ${labels}.` : "The packing list is empty.",
      "Suggest one item they likely need for this destination and season but have not listed.",
    ].join(" ")
  }

  if (surface === "itinerary") {
    const locations = await getItineraryLocations(trip.id)
    const names = locations.map((l) => l.name).join(", ")
    return [
      `The couple is planning ${header}. Surface: itinerary.`,
      locations.length ? `Locations planned: ${names}.` : "No locations planned yet.",
      "Suggest one itinerary idea or a gap worth filling.",
    ].join(" ")
  }

  if (surface === "notes") {
    const notes = await getTripNotes(trip.id)
    const bodies = notes.map((n) => n.body).join(" | ")
    return [
      `The couple is planning ${header}. Surface: notes.`,
      notes.length ? `Existing notes: ${bodies}.` : "No notes yet.",
      "Suggest one useful thing worth jotting down for this trip.",
    ].join(" ")
  }

  // road: today + next 3 days of the live itinerary.
  const today = await localToday()
  const days = await getItineraryDays(trip.id)
  const horizon = days.filter((d) => d.dayDate >= today).slice(0, 4)
  const horizonLines = horizon
    .map((d) => {
      const events = d.events
        .map((e) => `${e.time ? `${e.time} ` : ""}${e.text}`)
        .join(", ")
      return `${d.dayDate} ${d.title}${events ? `: ${events}` : ""}`
    })
    .join("; ")
  return [
    `The couple is on the road during ${header}. Surface: on the road. Today is ${today}.`,
    horizon.length
      ? `Next few days: ${horizonLines}.`
      : "Nothing scheduled for the next few days.",
    "Suggest one timely thing for today or the next few days.",
  ].join(" ")
}

/** One real suggestion for a surface. AI-gated + workspace-guarded. Suggest-only:
 * reads context, writes nothing. */
export async function suggestForSurface(
  surface: SurfaceKey,
  tripSlug?: string,
): Promise<{ suggestion?: Suggestion; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  try {
    const prompt = await buildPrompt(surface, workspace.id, tripSlug)
    if (!prompt) return { error: "No trip in context." }
    const suggestion = await generateSuggestion(prompt)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
