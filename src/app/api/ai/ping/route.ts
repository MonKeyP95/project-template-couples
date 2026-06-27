import { NextResponse } from "next/server"

import { pingClaude } from "@/lib/ai/claude"

// Temporary slice-0 smoke test: GET /api/ai/ping returns Claude's reply, to
// prove the key, route, cost, and latency in isolation. Remove (or guard behind
// a non-prod check) once Slice 1's real importer route lands.
export async function GET() {
  try {
    const reply = await pingClaude()
    return NextResponse.json({ reply })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
