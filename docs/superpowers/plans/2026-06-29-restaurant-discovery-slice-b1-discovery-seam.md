# Restaurant Discovery — Slice B1: Discovery Seam + Smoke Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one real Claude call that uses the built-in web-search tool to return a small, source-cited shortlist of restaurants for a trip, behind the one-file `lib/ai/claude.ts` seam, exercised through a curl-testable route — proving web-search quality, cost, and latency in isolation before any UI.

**Architecture:** A client-safe types file (`restaurant-discovery-types.ts`) defines the request/response shapes. `claude.ts` gains `searchRestaurants(query)` — a single `messages.create` with two tools: Anthropic's server-side `web_search` (to gather real, current results) and a strict custom `propose_restaurants` tool whose input schema *is* the shortlist (structured extraction via tool use, the same pattern the import-plan spec chose). A temporary `POST /api/ai/discover` route (AI-mode-gated) takes the query in its body and returns the suggestions as JSON, so the round-trip is curl-verifiable. No database, no auth, no writes, no UI — those are slice B2.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript 5, `@anthropic-ai/sdk` (already installed), pnpm.

## Global Constraints

- **No test framework exists.** Per `CLAUDE.md`, do not invent one. Verification is `pnpm build` + `pnpm lint` passing, plus a **manual** `curl` of the route (the build does not call the API, so it passes without spending). Do not add test files or a runner.
- **AI provider is one file.** Every Anthropic SDK call routes through `src/lib/ai/claude.ts` (per `CLAUDE.md` → "AI provider is one file"). The route and types files must NOT import `@anthropic-ai/sdk` — only `claude.ts` does.
- **Suggest-only.** `lib/ai` returns data only and never mutates (see the header of `src/lib/ai/ai-mode.ts`). This slice only reads/returns; no Server Actions, no DB writes.
- **Server-only key.** The Anthropic key is read from the server environment and never reaches the browser — hence the route-handler path. Do not import `claude.ts` into a `"use client"` component.
- **Model is fixed at `claude-sonnet-4-6`** (the existing `MODEL` constant in `claude.ts`). The web-search tool version `web_search_20260209` requires Sonnet 4.6 or an Opus 4.x model — do not change `MODEL` below that, and do not substitute a different model.
- **Grounding rule (copy verbatim into the system prompt):** every suggestion must come from a real web-search result and carry that result's URL; never invent a restaurant, a URL, or an exact price.
- **No emojis** in code or copy. **Sparse comments.** **Use `pnpm`** (never npm/yarn).
- **The route is temporary**, mirroring the slice-0 ping route: it is AI-mode-gated and body-driven for smoke-testing; slice B2 replaces it with the auth'd, preferences-and-trip-aware production endpoint. Mark it as such in a comment.

---

### Task 1: Discovery types — `restaurant-discovery-types.ts`

**Files:**
- Create: `src/lib/ai/restaurant-discovery-types.ts`

**Interfaces:**
- Produces:
  - `interface RestaurantQuery { destination: string; when: string; budgetBand: string; vibeTags: string[]; dietary: string[]; cuisines: string[] }`
  - `interface RestaurantSuggestion { name: string; why: string; area: string; priceHint: string; sourceUrl: string }`

This file is intentionally free of `server-only` and of any SDK import so a `"use client"` component (slice B2) can import `RestaurantSuggestion` to render results — the established `*-types.ts` split (see `memory/feedback-client-component-types-split.md`).

- [ ] **Step 1: Create the file**

```ts
// Shapes for the restaurant discovery agent. Pure types — no server-only, no
// SDK import — so a client component can import RestaurantSuggestion to render
// results (the *-types.ts split rule).

/** What we ask Claude to find — a trip's facts plus the couple's tastes. */
export interface RestaurantQuery {
  /** e.g. "Lombok, Indonesia". */
  destination: string
  /** Human label for when, e.g. "tomorrow" or "Fri 4 Jul". */
  when: string
  /** One of the dining-preferences bands ("any" | "budget" | "mid" | "splurge"). */
  budgetBand: string
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
}

/** One grounded, cited restaurant suggestion. */
export interface RestaurantSuggestion {
  name: string
  /** One sentence on why it fits this couple/trip. */
  why: string
  /** Neighbourhood or area. */
  area: string
  /** Rough price feel as text (e.g. "mid-range") — never an invented exact price. */
  priceHint: string
  /** A real URL from the web search that backs this suggestion. */
  sourceUrl: string
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build` then `pnpm lint`
Expected: both succeed (the file is imported nowhere yet — fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/restaurant-discovery-types.ts
git commit -m "feat(ai): restaurant discovery types (slice B1)"
```

---

### Task 2: The seam — `searchRestaurants` in `claude.ts`

**Files:**
- Modify: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: `RestaurantQuery`, `RestaurantSuggestion` from `./restaurant-discovery-types`; the existing module-level `anthropic` client and `MODEL` constant.
- Produces: `async function searchRestaurants(query: RestaurantQuery): Promise<RestaurantSuggestion[]>`.

**Context:** `claude.ts` currently exports `pingClaude` and holds `const MODEL = "claude-sonnet-4-6"` and `const anthropic = new Anthropic()`. Add to this file; do not create a second SDK file. The web-search tool runs server-side inside the single `messages.create` call; Claude searches, then calls our `propose_restaurants` tool with the structured shortlist. If the server-side tool loop hits its internal cap, the response comes back with `stop_reason: "pause_turn"` — resend to continue (a short bounded loop).

- [ ] **Step 1: Add the import**

At the top of `src/lib/ai/claude.ts`, after the existing `import Anthropic from "@anthropic-ai/sdk"` line, add:

```ts
import type {
  RestaurantQuery,
  RestaurantSuggestion,
} from "./restaurant-discovery-types"
```

- [ ] **Step 2: Append the seam function**

Add this to the end of `src/lib/ai/claude.ts` (after `pingClaude`):

```ts
// Restaurant discovery (slice B1). Claude uses the server-side web_search tool
// to find real, current restaurants, then calls propose_restaurants with a
// structured shortlist. Structured-extraction-via-tool-use keeps the result
// typed without fighting citations. The model never writes anything; the caller
// only reads the proposal.

const DISCOVERY_TOOLS: Anthropic.Messages.ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search" },
  {
    name: "propose_restaurants",
    description: "Return the final shortlist of restaurant suggestions.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              why: {
                type: "string",
                description: "One sentence on why it fits this couple/trip.",
              },
              area: { type: "string", description: "Neighbourhood or area." },
              priceHint: {
                type: "string",
                description:
                  "Rough price feel as text (e.g. 'mid-range'). Never an exact price.",
              },
              sourceUrl: {
                type: "string",
                description: "A real URL from the web search backing this pick.",
              },
            },
            required: ["name", "why", "area", "priceHint", "sourceUrl"],
          },
        },
      },
      required: ["suggestions"],
    },
  },
]

const DISCOVERY_SYSTEM =
  "You help a couple find restaurants for a trip. Use the web_search tool to " +
  "find real, currently-open restaurants near the destination that fit their " +
  "tastes. Then call propose_restaurants with 3 to 4 options. Every suggestion " +
  "must come from a real search result and include that result's URL as " +
  "sourceUrl. Never invent a restaurant, a URL, or an exact price. Keep each " +
  "'why' to one sentence tied to their stated preferences."

function discoveryPrompt(query: RestaurantQuery): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    `Budget: ${query.budgetBand}.`,
    list("Vibe", query.vibeTags),
    list("Dietary needs", query.dietary),
    list("Cuisines they love", query.cuisines),
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real web-search-backed restaurant shortlist for a trip. Returns [] if the
 * model finishes without proposing. */
export async function searchRestaurants(
  query: RestaurantQuery,
): Promise<RestaurantSuggestion[]> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: discoveryPrompt(query) },
  ]

  // Bounded loop only to resume the server-side search loop on pause_turn.
  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: DISCOVERY_SYSTEM,
      tools: DISCOVERY_TOOLS,
      messages,
    })

    const proposal = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_restaurants",
    )
    if (proposal) {
      const input = proposal.input as { suggestions?: RestaurantSuggestion[] }
      return input.suggestions ?? []
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content })
      continue
    }

    // Finished (end_turn / max_tokens) without proposing — no usable results.
    return []
  }
  return []
}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build` then `pnpm lint`
Expected: both succeed. `searchRestaurants` is imported nowhere yet (fine). If TypeScript complains that `strict` or `additionalProperties` is not assignable, confirm the tools array is annotated `Anthropic.Messages.ToolUnion[]` exactly as above (the custom-tool variant accepts `strict` + an `input_schema` with `additionalProperties`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(ai): searchRestaurants web-search seam (slice B1)"
```

---

### Task 3: Smoke route — `POST /api/ai/discover`

**Files:**
- Create: `src/app/api/ai/discover/route.ts`

**Interfaces:**
- Consumes: `searchRestaurants` from `@/lib/ai/claude`; `RestaurantQuery` from `@/lib/ai/restaurant-discovery-types`; `isAiEnabled` from `@/lib/ai/ai-mode`; `NextResponse` from `next/server`.
- Produces: `POST /api/ai/discover` → `{ suggestions: RestaurantSuggestion[] }` on success; `{ error }` with status 403 (AI off) or 500.

**Context:** Mirrors the slice-0 ping route's shape and "temporary smoke route" framing. It is AI-mode-gated (cookie) and takes the query in the request body so the Claude web-search round-trip can be exercised with curl, with no DB or auth. Slice B2 replaces it with the auth'd endpoint that loads real preferences + trip facts and is called by the Assistant.

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server"

import { searchRestaurants } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import type { RestaurantQuery } from "@/lib/ai/restaurant-discovery-types"

// Temporary slice-B1 smoke route: POST /api/ai/discover runs one real
// web-search-backed Claude call and returns a cited restaurant shortlist, to
// prove search quality, cost, and latency in isolation. AI-mode-gated and
// body-driven (no auth, no DB). Slice B2 replaces it with the auth'd endpoint
// that loads the couple's saved preferences + the trip's facts.
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
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build` then `pnpm lint`
Expected: both succeed; the route `/api/ai/discover` appears in the route list.

- [ ] **Step 3: Manual smoke test (real API call — spends a few cents)**

Run `pnpm dev`, then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/ai/discover \
  -H "Content-Type: application/json" \
  -H "Cookie: ai=on" \
  -d '{"destination":"Lombok, Indonesia","when":"tomorrow","budgetBand":"mid","vibeTags":["relaxed","seaside"],"dietary":[],"cuisines":["seafood"]}'
```

Expected: `{"suggestions":[{"name":"...","why":"...","area":"...","priceHint":"...","sourceUrl":"https://..."}, ...]}` — 3 to 4 items, each with a real `sourceUrl`. Latency is typically ~5-15s (the web search runs server-side). Cost is a few cents (web search has a small per-search surcharge on top of tokens; the workspace spend cap from slice 0 still applies).

Then confirm the AI gate: re-run **without** `-H "Cookie: ai=on"`. Expected: `{"error":"AI mode is off."}` with HTTP 403 (no API call, no spend).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/discover/route.ts
git commit -m "feat(ai): POST /api/ai/discover smoke route for web-search discovery (slice B1)"
```

---

## What this slice deliberately does NOT do

Per the spec, these are slice B2 (its own plan) — do not build them here:

- **The Assistant affordance** (a "find a restaurant" entry in `src/components/assistant.tsx`, the day prompt) and **cited result cards** (`SuggestionCard`-style rows with source links + an Add-to-itinerary action).
- **Loading real inputs from the session** — the couple's saved `dining_preferences` and the trip's destination/next-day. B1 takes them in the request body.
- **Auth/workspace gating and tightening/replacing the smoke route** for production use.
- **Accept → itinerary event** (slice C) and **feedback capture** (slice D).

## Self-review notes

- **Spec coverage:** implements the slice-B "discovery loop" core — `claude.ts` web search + the structured shortlist + a `/api/ai/discover` route (spec Design §2). The Assistant UI half of §3 is explicitly deferred to B2.
- **Invariants:** SDK touched only in `claude.ts`; key stays server-side (route handler); `lib/ai` returns data only (no writes); model stays `claude-sonnet-4-6` (required by `web_search_20260209`).
- **Type consistency:** `RestaurantQuery` / `RestaurantSuggestion` / `searchRestaurants` names and field sets are identical across the types file, the seam, and the route.
- **No placeholders:** every step contains the exact file contents or command.
