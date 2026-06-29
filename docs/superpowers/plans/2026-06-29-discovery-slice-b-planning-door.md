# Discovery Slice B-planning — Itinerary-Tab Planning Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the planning-mode discovery door — an on-page "find a place to eat" affordance on the itinerary tab (planning-only block) that searches restaurants near a chosen location and adds a pick to a day in that location.

**Architecture:** The planning twin of the on-the-road door, sharing the same engine (`POST /api/ai/discover`, preference-aware via B2). A self-contained client component does location selection, search, cited-row rendering, and accept; the itinerary tab mounts it once in its planning-only block. Reverses the spec's original "Assistant chip" sketch (the Assistant is a context-free global mock); see spec §3.

**Tech Stack:** Next.js 16 client component, React 19, TypeScript 5, Tailwind v4. No new dependencies, no schema change.

## Global Constraints

- **No test runner exists.** Validate with `pnpm lint` then `pnpm build`; final step is a manual authenticated browser check. No `*.test.ts`.
- **Shared engine, no seam change:** POST `/api/ai/discover` with `{ destination, when }`; preferences are merged server-side (B2). Do not touch `claude.ts`, the route, or `RestaurantQuery`.
- **Suggest-only:** the component reads suggestions and writes only via the existing `addTodayEvent` Server Action on an explicit click.
- **Planning-only:** the door mounts inside the itinerary tab's `planningBlock`, which renders only when the trip is not active (`{active ? null : planningBlock}`) — active trips use the on-the-road door.
- **Client/server split:** `"use client"`; import types from `*-types.ts`, never from `*-queries.ts`.
- **No emojis;** sparse comments. European date order where dates render (not relevant here).
- Commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Interfaces consumed (exact signatures)

- `useAiMode(): { enabled: boolean }` from `@/components/ai-mode`.
- `addTodayEvent(input: { tripId: string; tripSlug: string; dayDate: string; dayId: string | null; time: string; text: string }): Promise<{ error?: string }>` from `@/lib/trips/actions` (appends an event to a day by date/id — not today-specific).
- `RestaurantSuggestion` from `@/lib/ai/restaurant-discovery-types` — `{ name, why, area, priceHint, sourceUrl }`.
- `ItineraryDay` from `@/lib/trips/itinerary-types` — has `id`, `dayDate`, `locationId`.
- `ItineraryLocation` from `@/lib/trips/location-types` — has `id`, `name`.
- Route: `POST /api/ai/discover`, body `{ destination, when }` → `{ suggestions }` (200) or `{ error }`.

---

### Task 1: The planning discovery component

**Files:**
- Create: `src/app/trips/[slug]/find-a-place-planning.tsx`

**Interfaces:**
- Consumes: the list above.
- Produces: `FindAPlacePlanning(props: { tripId: string; tripSlug: string; locations: ItineraryLocation[]; days: ItineraryDay[] }): JSX.Element | null`.

- [ ] **Step 1: Write the component**

```tsx
// src/app/trips/[slug]/find-a-place-planning.tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { addTodayEvent } from "@/lib/trips/actions"
import type { RestaurantSuggestion } from "@/lib/ai/restaurant-discovery-types"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door: pick a location, find restaurants near it,
 * add a pick to that location's earliest day. Planning twin of the on-the-road
 * FindAPlace; shares the /api/ai/discover engine (preference-aware via B2). */
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
  const router = useRouter()
  const { enabled } = useAiMode()
  const [locId, setLocId] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    RestaurantSuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())

  if (!enabled || locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const targetDay =
    days
      .filter((d) => d.locationId === location.id)
      .sort((a, b) => a.dayDate.localeCompare(b.dayDate))[0] ?? null

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: location.name, when: "dinner" }),
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

  function addToItinerary(s: RestaurantSuggestion) {
    if (!targetDay) return
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: targetDay.dayDate,
      dayId: targetDay.id,
      time: "",
      text: `Dinner · ${s.name}`,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      router.refresh()
    })
  }

  return (
    <section className="mt-3 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · find a place to eat
      </span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={location.id}
          onChange={(e) => {
            setLocId(e.target.value)
            setSuggestions(null)
            setError(null)
          }}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={find}
          disabled={loading}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? "searching…" : "find dinner"}
        </button>
      </div>

      {suggestions && suggestions.length === 0 ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-4">
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
              <button
                type="button"
                onClick={() => addToItinerary(s)}
                disabled={!targetDay || added.has(s.name)}
                title={targetDay ? undefined : "Add a day to this location first"}
                className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {added.has(s.name)
                  ? "added"
                  : targetDay
                    ? `add to ${location.name}`
                    : "add a day first"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 2: Lint** — Run: `pnpm lint`. Expected: no errors (component unused until Task 2 — fine).
- [ ] **Step 3: Build** — Run: `pnpm build`. Expected: compiles clean.
- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/find-a-place-planning.tsx
git commit -m "feat(ai): itinerary-tab planning discovery component (slice B-planning)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Mount it in the itinerary tab's planning block

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: `FindAPlacePlanning` from Task 1. In-scope locals: `tripId`, `tripSlug`, `days` (state), `locations` (state).
- Produces: nothing (terminal wiring).

- [ ] **Step 1: Add the import** alongside the other component imports near the top (e.g. after `import { AiSuggestion } from "@/components/ai-suggestion"`):

```tsx
import { FindAPlacePlanning } from "./find-a-place-planning"
```

- [ ] **Step 2: Render it in the planning block.** The planning block ends with `<AiSuggestion surface="itinerary" />` just before its closing `</div>`. Insert the door immediately after that line:

```tsx
      <AiSuggestion surface="itinerary" />
      <FindAPlacePlanning
        tripId={tripId}
        tripSlug={tripSlug}
        locations={locations}
        days={days}
      />
```

- [ ] **Step 3: Lint** — Run: `pnpm lint`. Expected: no errors.
- [ ] **Step 4: Build** — Run: `pnpm build`. Expected: compiles clean.
- [ ] **Step 5: Manual authenticated verification** (needs a session; planning trip = today outside its dates):

1. `pnpm dev`; sign in; AI mode on; open a **non-active** trip's Itinerary tab with at least one location that has a day.
2. Under "+ location", confirm the moss "AI · find a place to eat" block shows with a location select + "find dinner".
3. Pick a location, tap "find dinner" (~30–60s) → 3–4 cited rows appear.
4. Tap "add to <location>" → the page refreshes and `"Dinner · <name>"` appears on that location's earliest day; the button reads "added".
5. With AI off, the block does not render. For a location with no days, the add button reads "add a day first" and is disabled.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(ai): mount planning discovery door in the itinerary tab (slice B-planning)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§3, planning door):**
- On-page on the itinerary tab, planning-only block → Task 2 placement after the itinerary `AiSuggestion` (inside `planningBlock`, which renders only when `!active`). ✓
- AI-mode-gated → Task 1 `useAiMode` guard. ✓
- Location select scopes the search; `{destination: name, when:"dinner"}` → Task 1 `find`. ✓
- Cited rows with source link → Task 1 row markup. ✓
- Accept → `"Dinner · <name>"` on the location's earliest day via `addTodayEvent`; disabled with hint when no days → Task 1 `addToItinerary` + button. ✓
- Source URL stays in the row (no event note field) → Task 1 (URL only in the row). ✓

**Placeholder scan:** none — full code given.

**Type consistency:** `ItineraryLocation.{id,name}`, `ItineraryDay.{id,dayDate,locationId}`, `addTodayEvent` input, and the route's `{suggestions}` response all match their definitions. `location` is always defined (`?? locations[0]` after the `locations.length === 0` guard); `targetDay` is guarded before use. ✓
