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
import type { SurfaceKey, Suggestion, SuggestScope, SuggestDay } from "@/lib/ai/suggestion-types"

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

const RESTRAINT =
  "Surface the single most valuable thing. Do not assume every day needs a " +
  "dinner or every gap needs filling; some open time is intentional."

/** Whole-trip overview prompt: locations, itinerary fill, budget, packing. */
async function buildTripPrompt(
  tripId: string,
  header: string,
  modeLine: string,
  onRoad: boolean,
  plannedBudgetCents: number | null,
): Promise<string> {
  const locations = await getItineraryLocations(tripId)
  const days = await getItineraryDays(tripId)
  const budget = await getBudgetItems(tripId)
  const packing = await getPackingItems(tripId)
  const locNames = locations.map((l) => l.name).join(", ") || "none yet"
  const planned = days.filter((d) => d.events.length > 0).length
  return [
    `${modeLine} Trip: ${header}. Scope: whole-trip overview.`,
    `Locations: ${locNames}.`,
    `Itinerary: ${days.length} days, ${planned} with something planned.`,
    plannedBudgetCents
      ? `Planned budget: ${EUR(plannedBudgetCents)}, ${budget.length} line items.`
      : `No overall budget set; ${budget.length} line items.`,
    `Packing list: ${packing.length} items.`,
    onRoad
      ? "Suggest the single most valuable thing for the rest of the trip."
      : "Suggest the single most valuable thing to plan next across the whole trip.",
    RESTRAINT,
  ].join(" ")
}

/** One-day prompt. Returns null if the date is not a real itinerary day. */
async function buildDayPrompt(
  tripId: string,
  header: string,
  modeLine: string,
  date: string,
): Promise<string | null> {
  const day = (await getItineraryDays(tripId)).find((d) => d.dayDate === date)
  if (!day) return null
  const events = day.events
    .map((e) => `${e.time ? `${e.time} ` : ""}${e.text}`)
    .join(", ")
  return [
    `${modeLine} Trip: ${header}. Scope: the day ${date} (${day.title}).`,
    events ? `Planned that day: ${events}.` : "Nothing planned that day yet.",
    "Suggest one worthwhile thing for that day.",
    RESTRAINT,
  ].join(" ")
}

/** Free-text prompt: the couple's own request, grounded in trip context. */
function buildFreePrompt(header: string, modeLine: string, text: string): string {
  return [
    `${modeLine} Trip: ${header}. Scope: the couple's own request.`,
    `They asked: "${text}".`,
    "Give one concrete, specific suggestion answering that request, grounded in the trip context.",
    RESTRAINT,
  ].join(" ")
}

/** Dispatch by scope. `page` falls through to the per-surface prompt (unchanged);
 * trip/day/free need a trip and add mode framing. Returns null when a required
 * trip is missing. */
async function buildScopedPrompt(
  surface: SurfaceKey,
  workspaceId: string,
  tripSlug: string | undefined,
  scope: SuggestScope,
): Promise<string | null> {
  if (scope.kind === "page") return buildPrompt(surface, workspaceId, tripSlug)
  if (!tripSlug) return null
  const trip = await getTripBySlug(workspaceId, tripSlug)
  if (!trip) return null
  const header = tripLine(trip.name, trip.country, trip.startDate, trip.endDate)
  const today = await localToday()
  const onRoad =
    trip.startDate != null &&
    trip.endDate != null &&
    today >= trip.startDate &&
    today <= trip.endDate
  const modeLine = onRoad
    ? `The couple is on the road; today is ${today}.`
    : "The couple is planning, before the trip."
  if (scope.kind === "trip")
    return buildTripPrompt(trip.id, header, modeLine, onRoad, trip.plannedBudgetCents)
  if (scope.kind === "day")
    return buildDayPrompt(trip.id, header, modeLine, scope.date)
  return buildFreePrompt(header, modeLine, scope.text)
}

/** One real suggestion for a surface. AI-gated + workspace-guarded. Suggest-only:
 * reads context, writes nothing. */
export async function suggestForSurface(
  surface: SurfaceKey,
  tripSlug?: string,
  scope: SuggestScope = { kind: "page" },
): Promise<{ suggestion?: Suggestion; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  try {
    const prompt = await buildScopedPrompt(surface, workspace.id, tripSlug, scope)
    if (!prompt) return { error: "No trip in context." }
    const suggestion = await generateSuggestion(prompt)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}

/** Days for the "a specific day" picker, plus the default date (today when on
 * the road and today is a real itinerary day, else null). AI-gated + guarded. */
export async function getSuggestDays(
  tripSlug: string,
): Promise<{ days: SuggestDay[]; defaultDate: string | null }> {
  if (!(await isAiEnabled())) return { days: [], defaultDate: null }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { days: [], defaultDate: null }
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return { days: [], defaultDate: null }

  const today = await localToday()
  const days: SuggestDay[] = (await getItineraryDays(trip.id)).map((d) => ({
    date: d.dayDate,
    label: `${d.dow} ${d.dom} ${d.mon}`,
    isToday: d.dayDate === today,
  }))
  const defaultDate = days.some((d) => d.isToday) ? today : null
  return { days, defaultDate }
}
