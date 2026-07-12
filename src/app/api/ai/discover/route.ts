import { NextResponse } from "next/server"

import { discover } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripProfile } from "@/lib/trips/queries"
import { EMPTY_TRIP_PROFILE } from "@/lib/trips/trip-profile-types"
import { getCoupleSummary } from "@/lib/preferences/couple-summary-queries"
import type {
  DiscoveryCategory,
  DiscoveryQuery,
} from "@/lib/ai/discovery-types"

// POST /api/ai/discover: one real web-search-backed Claude call returning a
// cited shortlist for a category. AI-mode-gated (the `ai` cookie) and auth-gated
// (the proxy requires a session). The body carries what a door knows —
// category + destination + when + optional tripId + the in-the-moment inputs;
// the couple's dining preferences and the trip profile are loaded server-side
// (server authoritative) and merged into the query.
export async function POST(request: Request) {
  if (!(await isAiEnabled())) {
    return NextResponse.json({ error: "AI mode is off." }, { status: 403 })
  }

  const workspace = await getCurrentWorkspace()
  if (!workspace) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      category?: string
      destination?: string
      when?: string
      tripId?: string
      craving?: string
      near?: string
      walkable?: boolean
    }
    const destination = String(body.destination ?? "").trim()
    if (!destination) {
      return NextResponse.json(
        { error: "destination required." },
        { status: 400 },
      )
    }

    const category: DiscoveryCategory =
      body.category === "activity" ? "activity" : "food"
    const prefs = await getDiningPreferences(workspace.id)
    const tripId = String(body.tripId ?? "").trim()
    const profile = tripId ? await getTripProfile(tripId) : EMPTY_TRIP_PROFILE
    const summary = await getCoupleSummary(workspace.id, category)

    const query: DiscoveryQuery = {
      category,
      destination,
      when: String(body.when ?? "soon").trim(),
      budgetBand: prefs.budgetBand,
      vibeTags: prefs.vibeTags,
      dietary: prefs.dietary,
      cuisines: prefs.cuisines,
      activities: prefs.activities,
      trip: { vibe: profile.vibe, brief: profile.idea },
      craving: String(body.craving ?? "").trim(),
      near: String(body.near ?? "").trim(),
      walkable: Boolean(body.walkable),
      learned: summary.summaryMd,
    }

    const suggestions = await discover(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
