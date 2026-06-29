import { NextResponse } from "next/server"

import { searchRestaurants } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import type { RestaurantQuery } from "@/lib/ai/restaurant-discovery-types"

// POST /api/ai/discover: one real web-search-backed Claude call returning a
// cited restaurant shortlist for the couple. AI-mode-gated (the `ai` cookie) and
// auth-gated (the proxy requires a session). The body carries only what a door
// knows — destination + when; the couple's saved dining preferences are loaded
// server-side and merged into the query (preferences are server-authoritative).
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
      destination?: string
      when?: string
    }
    const destination = String(body.destination ?? "").trim()
    if (!destination) {
      return NextResponse.json(
        { error: "destination required." },
        { status: 400 },
      )
    }

    const prefs = await getDiningPreferences(workspace.id)
    const query: RestaurantQuery = {
      destination,
      when: String(body.when ?? "soon").trim(),
      budgetBand: prefs.budgetBand,
      vibeTags: prefs.vibeTags,
      dietary: prefs.dietary,
      cuisines: prefs.cuisines,
    }

    const suggestions = await searchRestaurants(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
