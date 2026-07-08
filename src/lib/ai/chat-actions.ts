"use server"

import { chatReply } from "@/lib/ai/claude"
import type { ChatMessage } from "@/lib/ai/chat-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripBySlug } from "@/lib/trips/queries"

/** Server Action behind the floating assistant. Builds basic trip context when
 * a trip slug is supplied, then calls the real model. Any failure (missing key,
 * network, model error) returns one honest inline message. */
export async function sendChatMessage(
  messages: ChatMessage[],
  tripSlug?: string,
): Promise<string> {
  try {
    const context = tripSlug ? await tripContextFor(tripSlug) : ""
    return await chatReply(messages, context)
  } catch {
    return "I couldn't reach the assistant just now — try again in a moment."
  }
}

async function tripContextFor(slug: string): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return ""
  const trip = await getTripBySlug(workspace.id, slug)
  if (!trip) return ""

  const locations = await getItineraryLocations(trip.id)
  const lines: string[] = [`The user is looking at their trip "${trip.name}".`]
  if (trip.country) lines.push(`Destination: ${trip.country}.`)
  if (trip.startDate && trip.endDate) {
    lines.push(`Dates: ${trip.startDate} to ${trip.endDate}.`)
  } else if (trip.fuzzyWhen) {
    lines.push(`When: ${trip.fuzzyWhen}.`)
  }
  if (locations.length) {
    lines.push(`Itinerary places: ${locations.map((l) => l.name).join(", ")}.`)
  }
  const mode = tripMode(trip.startDate, trip.endDate)
  if (mode) lines.push(mode)
  return lines.join(" ")
}

/** Planning vs on-the-road, dates-driven (the app's mode rule). Coarse server
 * Date compare on ISO YYYY-MM-DD strings; a same-day timezone edge is
 * irrelevant to this hint. Null when the trip has no dates. */
function tripMode(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const today = new Date().toISOString().slice(0, 10)
  if (today >= startDate && today <= endDate) {
    return "They are on this trip right now — give present, in-the-moment help."
  }
  if (today < startDate) {
    return "This trip has not started yet — help them prepare and plan."
  }
  return "This trip is in the past — help them reflect or plan a future one."
}
