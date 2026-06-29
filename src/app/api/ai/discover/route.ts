import { NextResponse } from "next/server"

import { searchRestaurants } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import type { RestaurantQuery } from "@/lib/ai/restaurant-discovery-types"

// Temporary slice-B1 smoke route: POST /api/ai/discover runs one real
// web-search-backed Claude call and returns a cited restaurant shortlist, to
// prove search quality, cost, and latency in isolation. Body-driven, no DB;
// reachable only by an authenticated session (the proxy gate) with AI mode on
// (the `ai` cookie). Slice B2 replaces it with the endpoint that also loads the
// couple's saved preferences + the trip's facts.
export async function POST(request: Request) {
  if (!(await isAiEnabled())) {
    return NextResponse.json({ error: "AI mode is off." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as Partial<RestaurantQuery>
    const query: RestaurantQuery = {
      destination: String(body.destination ?? "").trim(),
      when: String(body.when ?? "soon").trim(),
      budgetBand: String(body.budgetBand ?? "any").trim(),
      vibeTags: Array.isArray(body.vibeTags) ? body.vibeTags : [],
      dietary: Array.isArray(body.dietary) ? body.dietary : [],
      cuisines: Array.isArray(body.cuisines) ? body.cuisines : [],
    }
    if (!query.destination) {
      return NextResponse.json({ error: "destination required." }, { status: 400 })
    }

    const suggestions = await searchRestaurants(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
