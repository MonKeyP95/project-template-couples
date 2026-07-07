# Discovery per category (slice 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single Food discovery door in each mode into one four-section accordion (Food / Accommodation / Transport / Activities) driven by a category-parameterized discovery engine; Food and Activities go live, Accommodation and Transport ship as visible-but-inactive "coming soon" sections.

**Architecture:** The `lib/ai` engine gains a `category` field ("food" | "activity") that selects the system prompt noun and the taste lines; the route reads `category` (defaulting to "food"). The Food-door body is extracted into one shared `DiscoverySection` client component (search inputs + fetch + results + add), and the profile accordion is relocated to a shared `CategorySection`. Both doors keep their file location and mode-specific setup but their body becomes a four-section accordion built from those two shared components.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions + Route Handlers), React 19, TypeScript 5, Tailwind v4, `@anthropic-ai/sdk` (web_search `web_search_20250305` + tool-use structured output, model `claude-sonnet-4-6`).

**Spec:** `docs/superpowers/specs/2026-07-07-discovery-per-category-slice5-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **No new deps, columns, migrations, or AI provider surface.** `lib/ai` stays the one seam; all discovery is suggest-only (the model never writes).
- **Model is `claude-sonnet-4-6`** — do not change it.
- **No test framework exists.** Verification for every task is `pnpm lint` then `pnpm build`, both clean. Do not invent a test command.
- **Controller does all git.** Subagents edit + lint + build only; they never run `git add`/`commit`/`mv`/`rm -` on tracked files via git. File deletions use a plain filesystem `rm` (the controller commits the deletion). This branch may hold unrelated uncommitted work — never run broad `git add`/`reset`.
- **Client/type split rule:** `"use client"` files import query-layer types from `*-types.ts` modules (pure types, no `server-only`/SDK), never from `*-queries.ts`. `discovery-types.ts` stays pure.
- **European dates:** any date display uses `en-GB`. (Day labels reuse `ItineraryDay.date`, already `en-GB`.)
- **No emojis** in code, strings, or logs.
- **Food behavior must not regress:** after Task 1 the food prompt/output is functionally identical (only the tool name `propose_restaurants` -> `propose_places` and the neutral wording "invent a place" change).

## File Structure

- `src/lib/ai/discovery-types.ts` — **new.** Generalized query/suggestion types + `DiscoveryCategory`. Pure types.
- `src/lib/ai/restaurant-discovery-types.ts` — **deleted in Task 5** once all importers move off it.
- `src/lib/ai/claude.ts` — **modified.** Category-parameterized system prompt + branched `discoveryPrompt`; tool renamed `propose_places`; `searchRestaurants` -> `discover`.
- `src/app/api/ai/discover/route.ts` — **modified.** Reads `category` (default "food"); builds `DiscoveryQuery`; calls `discover`.
- `src/components/category-section.tsx` — **new.** Relocated + renamed accordion (`CategorySection`), shared by profile + both doors.
- `src/app/profile/profile-category.tsx` — **deleted in Task 2.**
- `src/app/profile/page.tsx` — **modified.** Imports/uses `CategorySection`.
- `src/components/discovery-section.tsx` — **new.** The shared search+results+add body for one category.
- `src/app/on-the-road/find-a-place.tsx` — **rewritten.** Four-section accordion.
- `src/app/on-the-road/page.tsx` — **modified.** Drops `todayEventTexts` prop + its computation.
- `src/app/trips/[slug]/find-a-place-planning.tsx` — **rewritten.** Location select + four-section accordion.

**Build-green ordering:** 1 (types + engine + route, old types file left in place) -> 2 (relocate accordion) -> 3 (create shared DiscoverySection, unused) -> 4 (rebuild on-the-road door + its mount) -> 5 (rebuild planning door + delete orphaned types file). Each task leaves `pnpm build` green.

---

### Task 1: Generalize the discovery engine and types

**Files:**
- Create: `src/lib/ai/discovery-types.ts`
- Modify: `src/lib/ai/claude.ts` (full rewrite)
- Modify: `src/app/api/ai/discover/route.ts` (full rewrite)
- Leave untouched: `src/lib/ai/restaurant-discovery-types.ts` (still imported by the two doors; deleted in Task 5)

**Interfaces:**
- Produces: `DiscoveryCategory = "food" | "activity"`; `DiscoveryQuery` (adds `category: DiscoveryCategory` to the old `RestaurantQuery` fields); `DiscoverySuggestion` (same fields as `RestaurantSuggestion`); `discover(query: DiscoveryQuery): Promise<DiscoverySuggestion[]>`.
- Consumes: nothing new.

Note: the two door components still import `RestaurantSuggestion` from `restaurant-discovery-types.ts` and call `/api/ai/discover` with no `category`. That keeps compiling (old file present) and keeps working (route defaults to "food"). Tasks 4-5 migrate them.

- [ ] **Step 1: Create `src/lib/ai/discovery-types.ts`**

```ts
// Shapes for the discovery agent (any category). Pure types — no server-only, no
// SDK import — so a client component can import DiscoverySuggestion to render
// results (the *-types.ts split rule).

/** Which kind of place we are finding. Food and activity are live; the door may
 * show other categories as inactive. */
export type DiscoveryCategory = "food" | "activity"

/** What we ask Claude to find — the category, a trip's facts, the couple's
 * tastes, and the in-the-moment inputs (craving + walkable-from-anchor). */
export interface DiscoveryQuery {
  category: DiscoveryCategory
  /** e.g. "Lombok, Indonesia". */
  destination: string
  /** Human label for when, e.g. "dinner tonight". Unused for activity. */
  when: string
  /** One of the dining-preferences bands ("any" | "budget" | "mid" | "splurge"). */
  budgetBand: string
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
  /** Couple activities (slice 2), e.g. "surf, hike, museums". */
  activities: string[]
  /** This-trip layer from the trip profile. */
  trip: { vibe: string[]; brief: string }
  /** In-the-moment "what do you feel like?"; "" when unset. Highest-priority signal. */
  craving: string
  /** Proximity anchor for walkable search; "" when unset. */
  near: string
  /** On-foot hard constraint. */
  walkable: boolean
}

/** One grounded, cited suggestion. */
export interface DiscoverySuggestion {
  name: string
  /** One sentence on why it fits this couple/trip. */
  why: string
  /** Neighbourhood or area. */
  area: string
  /** Rough cost feel as text (e.g. "mid-range") — never an invented exact price. */
  priceHint: string
  /** A real URL from the web search that backs this suggestion. */
  sourceUrl: string
}
```

- [ ] **Step 2: Rewrite `src/lib/ai/claude.ts`**

```ts
import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import type {
  DiscoveryCategory,
  DiscoveryQuery,
  DiscoverySuggestion,
} from "./discovery-types"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser.
 */

const MODEL = "claude-sonnet-4-6"

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from process.env

/** A trivial real round-trip. Returns Claude's reply text (expected: "pong"). */
export async function pingClaude(): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}

// Discovery. Claude uses the server-side web_search tool to find real, current
// places for a category (food or activity), then calls propose_places with a
// structured shortlist. Structured-extraction-via-tool-use keeps the result
// typed without fighting citations. The model never writes anything; the caller
// only reads the proposal.

const DISCOVERY_TOOLS: Anthropic.Messages.ToolUnion[] = [
  // Basic web_search (not the _20260209 variant): its built-in "dynamic
  // filtering" spins up server-side code_execution to pre-filter results,
  // which tripled latency for no quality gain. Cap rounds too — 3 is plenty.
  { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  {
    name: "propose_places",
    description: "Return the final shortlist of place suggestions.",
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
                  "Rough cost feel as text (e.g. 'mid-range'). Never an exact price.",
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

/** System prompt for a category. Only the noun differs between food and
 * activity; the search discipline and precedence rule are shared. */
function discoverySystem(category: DiscoveryCategory): string {
  const noun = category === "activity" ? "things to do" : "restaurants"
  return (
    `You help a couple find ${noun} for a trip. Never ask the user questions ` +
    "or reply conversationally — you cannot receive a reply. On every request you " +
    `MUST: (1) use the web_search tool to find real, currently-open ${noun} ` +
    "near the destination, then (2) call propose_places with 3 to 4 options. " +
    "If their preferences are sparse, search for well-regarded, broadly-appealing " +
    `${noun} for that destination anyway — do not ask for more detail. Every ` +
    "suggestion must come from a real search result and include that result's URL " +
    "as sourceUrl. Never invent a place, a URL, or an exact price. Keep each " +
    "'why' to one sentence. When choosing, weight what they are in the mood for " +
    "right now first, then this trip's vibe and brief, then the couple's general " +
    "tastes. If told they are on foot, only propose places genuinely within " +
    "walking distance of the given anchor — never somewhere that needs a car or a " +
    "long ride."
  )
}

function discoveryPrompt(query: DiscoveryQuery): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const anchor = query.near || query.destination
  const tripLines = [
    list("This trip's vibe", query.trip.vibe),
    query.trip.brief ? `Trip brief: ${query.trip.brief}.` : "",
  ].filter(Boolean)
  const moment = [
    query.craving ? `Right now they are in the mood for: ${query.craving}.` : "",
    query.walkable
      ? `They are on foot — only suggest places within easy walking distance of ${anchor}.`
      : query.near
        ? `Prefer places near ${query.near}.`
        : "",
  ]

  if (query.category === "activity") {
    return [
      `Find things to do in ${query.destination}.`,
      ...moment,
      "The couple generally —",
      list("Activities they enjoy", query.activities),
      list("Vibe", query.vibeTags),
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }

  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    ...moment,
    "The couple generally —",
    `Budget: ${query.budgetBand}.`,
    list("Vibe", query.vibeTags),
    list("Dietary needs", query.dietary),
    list("Cuisines they love", query.cuisines),
    list("Activities they enjoy", query.activities),
    ...(tripLines.length ? ["This trip —", ...tripLines] : []),
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real web-search-backed shortlist for a trip + category. Returns [] if the
 * model finishes without proposing. */
export async function discover(
  query: DiscoveryQuery,
): Promise<DiscoverySuggestion[]> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: discoveryPrompt(query) },
  ]

  // Bounded loop only to resume the server-side search loop on pause_turn.
  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: discoverySystem(query.category),
      tools: DISCOVERY_TOOLS,
      messages,
    })

    const proposal = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_places",
    )
    if (proposal) {
      const input = proposal.input as { suggestions?: DiscoverySuggestion[] }
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

- [ ] **Step 3: Rewrite `src/app/api/ai/discover/route.ts`**

```ts
import { NextResponse } from "next/server"

import { discover } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripProfile } from "@/lib/trips/queries"
import { EMPTY_TRIP_PROFILE } from "@/lib/trips/trip-profile-types"
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

    const query: DiscoveryQuery = {
      category,
      destination,
      when: String(body.when ?? "soon").trim(),
      budgetBand: prefs.budgetBand,
      vibeTags: prefs.vibeTags,
      dietary: prefs.dietary,
      cuisines: prefs.cuisines,
      activities: prefs.activities,
      trip: { vibe: profile.vibe, brief: profile.brief },
      craving: String(body.craving ?? "").trim(),
      near: String(body.near ?? "").trim(),
      walkable: Boolean(body.walkable),
    }

    const suggestions = await discover(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Lint** — Run: `pnpm lint`. Expected: no errors/warnings.
- [ ] **Step 5: Build** — Run: `pnpm build`. Expected: compiles clean. (If it exits `0xc0000142` on Windows, delete `.next/` and re-run — that is a Turbopack subprocess flake, not a code error.)

---

### Task 2: Relocate the accordion to a shared `CategorySection`

**Files:**
- Create: `src/components/category-section.tsx`
- Modify: `src/app/profile/page.tsx` (import + four usages)
- Delete: `src/app/profile/profile-category.tsx`

**Interfaces:**
- Produces: `CategorySection({ title, hint?, defaultOpen?, children })` — same behavior as the old `ProfileCategory`, category-neutral name and location so the doors can reuse it.
- Consumes: nothing new.

`ProfileCategory` is only imported by `src/app/profile/page.tsx` (verified). No other consumer.

- [ ] **Step 1: Create `src/components/category-section.tsx`**

```tsx
"use client"

import * as React from "react"

/** One collapsible category panel: an always-visible header (title + optional
 * muted hint) that toggles a body. Each panel keeps its own open state. Shared
 * by the couple profile and the discovery doors. */
export function CategorySection({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className="border-t border-border pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-serif text-xl tracking-tight">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {hint ? <span>{hint}</span> : null}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}
```

- [ ] **Step 2: Update the import in `src/app/profile/page.tsx`**

Replace this line:

```tsx
import { ProfileCategory } from "./profile-category"
```

with:

```tsx
import { CategorySection } from "@/components/category-section"
```

- [ ] **Step 3: Rename the four usages in `src/app/profile/page.tsx`**

Replace all four opening tags `<ProfileCategory` with `<CategorySection`, and all four closing tags `</ProfileCategory>` with `</CategorySection>`. The props (`title`, `hint`, `defaultOpen`) and children are unchanged. After this step, `git grep ProfileCategory src/` must return nothing.

- [ ] **Step 4: Delete the old file** — `rm "src/app/profile/profile-category.tsx"` (plain filesystem delete; the controller commits it).

- [ ] **Step 5: Lint** — Run: `pnpm lint`. Expected: no errors.
- [ ] **Step 6: Build** — Run: `pnpm build`. Expected: compiles clean.

---

### Task 3: Create the shared `DiscoverySection` component

**Files:**
- Create: `src/components/discovery-section.tsx`

**Interfaces:**
- Produces:
  - `type AddTarget = { kind: "fixed"; dayDate: string; dayId: string | null } | { kind: "select"; days: { id: string; dayDate: string; label: string }[] }`
  - `DiscoverySection({ category, tripId, tripSlug, destination, when, defaultNear, defaultWalkable, addTarget, buildEventText, ctaLabel })`
- Consumes: `DiscoveryCategory`, `DiscoverySuggestion` from `@/lib/ai/discovery-types` (Task 1); `addTodayEvent` from `@/lib/trips/actions`.

This is the extracted Food-door body, generalized: it owns the craving/near/walkable inputs, the POST to `/api/ai/discover` (sending `category`), loading/error state, the results list, and the per-result add affordance. The parent supplies exactly one `AddTarget` shape — `"fixed"` shows just a time input on confirm; `"select"` shows a day `<select>` + time input, and an "add a day first" state when its `days` list is empty. It is created here but wired into the doors in Tasks 4-5, so it is unused after this task (an unused client component compiles fine — build stays green).

- [ ] **Step 1: Create `src/components/discovery-section.tsx`**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addTodayEvent } from "@/lib/trips/actions"
import type {
  DiscoveryCategory,
  DiscoverySuggestion,
} from "@/lib/ai/discovery-types"

/** Where an added pick lands: a fixed day (on-the-road today) or a chosen day
 * from a list (planning). The parent supplies exactly one shape. */
export type AddTarget =
  | { kind: "fixed"; dayDate: string; dayId: string | null }
  | { kind: "select"; days: { id: string; dayDate: string; label: string }[] }

/** The shared discovery body for one category: craving/near/walkable inputs, the
 * web-search call to /api/ai/discover, the results list, and the add affordance.
 * Mode-specific context (destination, when, defaults, add target, event text)
 * comes in as props. */
export function DiscoverySection({
  category,
  tripId,
  tripSlug,
  destination,
  when,
  defaultNear,
  defaultWalkable,
  addTarget,
  buildEventText,
  ctaLabel,
}: {
  category: DiscoveryCategory
  tripId: string
  tripSlug: string
  destination: string
  when: string
  defaultNear: string
  defaultWalkable: boolean
  addTarget: AddTarget
  buildEventText: (s: DiscoverySuggestion) => string
  ctaLabel: string
}) {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    DiscoverySuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [time, setTime] = React.useState("")
  const [craving, setCraving] = React.useState("")
  const [near, setNear] = React.useState(defaultNear)
  const [walkable, setWalkable] = React.useState(defaultWalkable)
  const [selDayId, setSelDayId] = React.useState("")

  const noDays = addTarget.kind === "select" && addTarget.days.length === 0

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          destination,
          when,
          tripId,
          craving: craving.trim(),
          near: near.trim(),
          walkable,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Search failed.")
        return
      }
      setSuggestions(data.suggestions ?? [])
    } catch {
      setError("Search failed.")
    } finally {
      setLoading(false)
    }
  }

  function commit(s: DiscoverySuggestion) {
    let dayDate: string
    let dayId: string | null
    if (addTarget.kind === "fixed") {
      dayDate = addTarget.dayDate
      dayId = addTarget.dayId
    } else {
      const day =
        addTarget.days.find((d) => d.id === selDayId) ?? addTarget.days[0]
      if (!day) return
      dayDate = day.dayDate
      dayId = day.id
    }
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: time.trim(),
      text: buildEventText(s),
      url: s.sourceUrl,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      setConfirmingName(null)
      setTime("")
      router.refresh()
    })
  }

  return (
    <div>
      {suggestions === null ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={craving}
            onChange={(e) => setCraving(e.target.value)}
            placeholder="what do you feel like? (optional)"
            className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
          <input
            type="text"
            value={near}
            onChange={(e) => setNear(e.target.value)}
            placeholder="near…"
            className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <input
              type="checkbox"
              checked={walkable}
              onChange={(e) => setWalkable(e.target.checked)}
            />
            walking distance
          </label>
          <button
            type="button"
            onClick={find}
            disabled={loading}
            className="block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {loading ? "searching…" : "find"}
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <li key={s.sourceUrl} className="flex flex-col gap-1">
              <div className="t-display text-[16px] leading-tight text-foreground">
                {s.name}
              </div>
              <div className="text-[13px] leading-snug text-muted-foreground">
                {s.why}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {s.area} · {s.priceHint}
              </div>
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
              >
                source — verify hours
              </a>
              {added.has(s.name) ? (
                <span className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                  added
                </span>
              ) : noDays ? (
                <span
                  title="Add a day to this location first"
                  className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add a day first
                </span>
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {addTarget.kind === "select" ? (
                    <select
                      value={selDayId}
                      onChange={(e) => setSelDayId(e.target.value)}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                    >
                      {addTarget.days.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="19:30"
                    className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commit(s)}
                    className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                  >
                    add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingName(null)
                      setTime("")
                    }}
                    aria-label="Cancel"
                    className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingName(s.name)
                    if (addTarget.kind === "select") {
                      setSelDayId(addTarget.days[0].id)
                    }
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  {ctaLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
```

Note on the `key` reset (used by the planning door in Task 5): `near`/`walkable` initialize from props only on mount, so the parent remounts this component (via a `key` that includes the location id) to reset it when the location changes — not a `useEffect` (the React-19 in-place-reset gotcha).

- [ ] **Step 2: Lint** — Run: `pnpm lint`. Expected: no errors.
- [ ] **Step 3: Build** — Run: `pnpm build`. Expected: compiles clean (component compiles though nothing imports it yet).

---

### Task 4: Rebuild the on-the-road door as a four-section accordion

**Files:**
- Modify: `src/app/on-the-road/find-a-place.tsx` (full rewrite)
- Modify: `src/app/on-the-road/page.tsx` (drop `todayEventTexts`)

**Interfaces:**
- Consumes: `CategorySection` (Task 2), `DiscoverySection` + `AddTarget` (Task 3), `currentMeal`/`mealLabel`/`mealWhen`/`Meal` from `./meal-slot`.
- Produces: `FindAPlace({ tripId, tripSlug, dayDate, dayId, destination })` — the `todayEventTexts` prop is removed.

Behavior change (spec-approved: "plan decides the least-surprising rule"): the door no longer hides when the current meal is already planned. With two live categories a whole-door hide no longer makes sense, and suppressing only the Food section adds conditional weight for little gain. The door now renders whenever AI mode is on and a client-side meal is known. This drops the `mealAlreadyPlanned` import and the `todayEventTexts` prop. Both Food and Activities anchor to today's fixed day; Food's event text is the meal label, Activities' is the bare name. Accommodation and Transport are inactive "coming soon" sections.

- [ ] **Step 1: Rewrite `src/app/on-the-road/find-a-place.tsx`**

```tsx
"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { CategorySection } from "@/components/category-section"
import { DiscoverySection } from "@/components/discovery-section"
import { currentMeal, mealLabel, mealWhen, type Meal } from "./meal-slot"

/** On-the-road discovery door: a four-section accordion (Food + Activities live;
 * Accommodation + Transport coming soon) anchored to today. Renders whenever AI
 * mode is on and a device-local meal is known. */
export function FindAPlace({
  tripId,
  tripSlug,
  dayDate,
  dayId,
  destination,
}: {
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
  destination: string
}) {
  const { enabled } = useAiMode()

  // Meal is a client-only value: the server has no device clock, so it must be
  // null during SSR to avoid a hydration mismatch. useSyncExternalStore is the
  // React 19 way to read such a value without setState-in-effect.
  const meal = React.useSyncExternalStore<Meal | null>(
    () => () => {},
    () => currentMeal(new Date()),
    () => null,
  )

  if (!enabled || !meal) return null

  const activeMeal: Meal = meal
  const label = mealLabel(activeMeal)

  return (
    <section className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · suggestions
      </span>
      <div className="mt-2 flex flex-col gap-1">
        <CategorySection title="Food" defaultOpen>
          <DiscoverySection
            category="food"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            when={mealWhen(activeMeal)}
            defaultNear={destination}
            defaultWalkable
            addTarget={{ kind: "fixed", dayDate, dayId }}
            buildEventText={(s) => `${label} · ${s.name}`}
            ctaLabel="add to today"
          />
        </CategorySection>

        <CategorySection title="Activities">
          <DiscoverySection
            category="activity"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            when=""
            defaultNear={destination}
            defaultWalkable
            addTarget={{ kind: "fixed", dayDate, dayId }}
            buildEventText={(s) => s.name}
            ctaLabel="add to today"
          />
        </CategorySection>

        <CategorySection title="Accommodation" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find a place to stay.
          </p>
        </CategorySection>

        <CategorySection title="Transport" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find how to get around.
          </p>
        </CategorySection>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Drop the `todayEventTexts` prop in `src/app/on-the-road/page.tsx`**

Remove the prop line from the `<FindAPlace>` usage:

```tsx
        todayEventTexts={todayEventTexts}
```

so the element reads:

```tsx
      <FindAPlace
        tripId={trip.id}
        tripSlug={trip.slug}
        dayDate={today}
        dayId={todayDay?.id ?? null}
        destination={searchDestination}
      />
```

- [ ] **Step 3: Remove the now-unused computation in `src/app/on-the-road/page.tsx`**

Delete this line (it existed only to feed the removed prop):

```tsx
  const todayEventTexts = todayDay?.events.map((e) => e.text) ?? []
```

After this, `git grep todayEventTexts src/` must return nothing. (`mealAlreadyPlanned` stays exported from `meal-slot.ts` unused — leave it; it is a harmless pure helper and touching that file is out of scope.)

- [ ] **Step 4: Lint** — Run: `pnpm lint`. Expected: no errors (no unused-var warning for `todayEventTexts`).
- [ ] **Step 5: Build** — Run: `pnpm build`. Expected: compiles clean.

---

### Task 5: Rebuild the planning door as a four-section accordion; delete the old types file

**Files:**
- Modify: `src/app/trips/[slug]/find-a-place-planning.tsx` (full rewrite)
- Delete: `src/lib/ai/restaurant-discovery-types.ts`

**Interfaces:**
- Consumes: `CategorySection` (Task 2), `DiscoverySection` + `AddTarget` (Task 3), `ItineraryDay`, `ItineraryLocation`.
- Produces: `FindAPlacePlanning({ tripId, tripSlug, locations, days })` — props unchanged, so the mount in `itinerary-tab.tsx` needs no edit.

The location `<select>` moves to the top of the door (shared by all sections); each live section searches near the selected location and adds to one of its days. The `DiscoverySection` is keyed by `location.id` so switching location remounts it with fresh state and the new `defaultNear`. Day options reuse `ItineraryDay.date` (already `en-GB`). After the rewrite, no file imports `restaurant-discovery-types` — delete it.

- [ ] **Step 1: Rewrite `src/app/trips/[slug]/find-a-place-planning.tsx`**

```tsx
"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { CategorySection } from "@/components/category-section"
import { DiscoverySection } from "@/components/discovery-section"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door: pick a location, then a four-section accordion
 * (Food + Activities live; Accommodation + Transport coming soon) searches near
 * it and adds picks to one of that location's days. */
export function FindAPlacePlanning({
  tripId,
  tripSlug,
  locations,
  days,
}: {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
  days: ItineraryDay[]
}) {
  const { enabled } = useAiMode()
  const [locId, setLocId] = React.useState("")

  if (!enabled || locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const dayOptions = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
    .map((d) => ({
      id: d.id,
      dayDate: d.dayDate,
      label: `Day ${d.d} · ${d.date}`,
    }))

  return (
    <section className="mt-3 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · plan a place
      </span>
      <select
        value={location.id}
        onChange={(e) => setLocId(e.target.value)}
        className="mt-2 block rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <div className="mt-3 flex flex-col gap-1">
        <CategorySection title="Food" defaultOpen>
          <DiscoverySection
            key={`${location.id}-food`}
            category="food"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={location.name}
            when="dinner"
            defaultNear={location.name}
            defaultWalkable={false}
            addTarget={{ kind: "select", days: dayOptions }}
            buildEventText={(s) => `Dinner · ${s.name}`}
            ctaLabel={`add to ${location.name}`}
          />
        </CategorySection>

        <CategorySection title="Activities">
          <DiscoverySection
            key={`${location.id}-activity`}
            category="activity"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={location.name}
            when=""
            defaultNear={location.name}
            defaultWalkable={false}
            addTarget={{ kind: "select", days: dayOptions }}
            buildEventText={(s) => s.name}
            ctaLabel={`add to ${location.name}`}
          />
        </CategorySection>

        <CategorySection title="Accommodation" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find a place to stay.
          </p>
        </CategorySection>

        <CategorySection title="Transport" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find how to get around.
          </p>
        </CategorySection>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify the old types file is orphaned** — Run: `git grep -l "restaurant-discovery-types" src/`. Expected: no output (claude.ts + route.ts moved in Task 1, both doors moved in Tasks 4-5).

- [ ] **Step 3: Delete the old types file** — `rm "src/lib/ai/restaurant-discovery-types.ts"` (plain filesystem delete; the controller commits it).

- [ ] **Step 4: Lint** — Run: `pnpm lint`. Expected: no errors.
- [ ] **Step 5: Build** — Run: `pnpm build`. Expected: compiles clean.

---

## Self-Review

**Spec coverage:**
- Engine generalized to a `category` param, branched system prompt + `discoveryPrompt`, tool renamed `propose_places`, `searchRestaurants` -> `discover` — Task 1.
- Types renamed `restaurant-discovery-types.ts` -> `discovery-types.ts` with `DiscoveryQuery`/`DiscoverySuggestion`/`DiscoveryCategory` — Tasks 1 (create) + 5 (delete old).
- Route reads `category`, default "food", back-compatible — Task 1.
- Shared `DiscoverySection` (search + fetch + results + add; `AddTarget` fixed/select; `buildEventText`) — Task 3.
- Accordion relocated to shared `CategorySection` — Task 2.
- Both doors become four-section accordions with mode defaults preserved (on-the-road walkable on / today fixed day / meal-label text; planning walkable off / "dinner"/name text / day-select from the location's days) — Tasks 4-5.
- Accommodation + Transport inactive "coming soon" — Tasks 4-5.
- Pairing rule honored: Activities gets its first reader; Accommodation/Transport stay inactive (no profile section) — Tasks 4-5.

**Placeholder scan:** none — every code step carries full content.

**Type consistency:** `discover(query: DiscoveryQuery): Promise<DiscoverySuggestion[]>`, tool name `propose_places`, and the `.find(... block.name === "propose_places")` match across Task 1. `DiscoverySection` prop names, `AddTarget` shape, and `buildEventText`/`ctaLabel` match between Task 3 (definition) and Tasks 4-5 (call sites). `FindAPlace` loses `todayEventTexts` in both the component (Task 4 Step 1) and its mount (Task 4 Step 2). `FindAPlacePlanning` props unchanged, so its mount is untouched.

**Two open resolutions recorded (both spec-flagged "plan decides"):**
1. `DiscoverySection` lives at `src/components/discovery-section.tsx` (shared, since both modes use it).
2. The on-the-road door drops the meal-already-planned suppression entirely (simplest least-surprising rule); this removes the `todayEventTexts` prop.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-07-discovery-per-category-slice5.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh implementer per task, task review between tasks, broad review at the end. Tasks 1/3 are large but pure transcription (cheap-tier implementer); 4/5 are wiring (mid-tier).
2. **Inline Execution** — execute the five tasks in this session with checkpoints.

Which approach?

