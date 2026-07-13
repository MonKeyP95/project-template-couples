"use server"

import { chatReply } from "@/lib/ai/claude"
import type { ChatMessage } from "@/lib/ai/chat-types"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripBySlug } from "@/lib/trips/queries"

/** Server Action behind the assistant chat. Builds the shared assistant context
 * (trip facts when a slug is supplied, plus the profile block + taste dial) then
 * calls the real model. Any failure returns one honest inline message. */
export async function sendChatMessage(
  messages: ChatMessage[],
  tripSlug?: string,
): Promise<string> {
  try {
    const context = await chatContext(tripSlug)
    return await chatReply(messages, context)
  } catch {
    return "I couldn't reach the assistant just now — try again in a moment."
  }
}

async function chatContext(slug?: string): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return ""

  const lines: string[] = []
  let tripId: string | undefined
  if (slug) {
    const trip = await getTripBySlug(workspace.id, slug)
    if (trip) {
      tripId = trip.id
      lines.push(`The user is looking at their trip "${trip.name}".`)
      if (trip.country) lines.push(`Destination: ${trip.country}.`)
      if (trip.startDate && trip.endDate) {
        lines.push(`Dates: ${trip.startDate} to ${trip.endDate}.`)
      } else if (trip.fuzzyWhen) {
        lines.push(`When: ${trip.fuzzyWhen}.`)
      }
      const locations = await getItineraryLocations(trip.id)
      if (locations.length) {
        lines.push(
          `Itinerary places: ${locations.map((l) => l.name).join(", ")}.`,
        )
      }
      const mode = tripMode(trip.startDate, trip.endDate)
      if (mode) lines.push(mode)
    }
  }

  const { profileBlock, tasteDirective } = await buildAssistantContext(
    workspace.id,
    tripId,
  )
  if (profileBlock) {
    lines.push(
      `Who they are (background - a lens, not a checklist): ${profileBlock}`,
    )
    lines.push(tasteDirective)
  }
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
