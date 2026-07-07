# Discovery Reads Trip Profile + In-the-Moment (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make restaurant discovery read the trip profile (vibe + brief) and the couple's slice-2 activities, and add two in-the-moment door inputs — a free-text craving and a walkable-from-anchor proximity constraint.

**Architecture:** The door POSTs `tripId` + `{craving, near, walkable}`; the route loads couple prefs (as today) and a new `getTripProfile(tripId)`, and builds an enriched `RestaurantQuery`. Precedence (craving > this trip > couple defaults; walkability a hard constraint) is expressed in the Claude prompt + system instruction — no code-level field merge. Tasks are ordered so the build stays green at every boundary (the route populates all new query fields before the prompt reads them).

**Tech Stack:** Next.js 16 App Router (Route Handler + client components), TypeScript 5, Supabase (RLS), `@anthropic-ai/sdk` (web_search tool), Tailwind v4.

## Global Constraints

- **No test framework exists.** Verify every task with `pnpm lint` then `pnpm build`; there is no test command — do not invent one. On Windows, a Turbopack subprocess panic (exit `0xc0000142`) is an environment flake — delete `.next/` and retry once.
- **No migration, no new deps, no new vendor.** All columns exist; proximity is text the model searches on, not a geo radius (a maps API is explicitly out).
- **`lib/ai` is the one seam; suggest-only** — nothing under `lib/ai` writes.
- **Signal priority (highest first):** (1) craving, (2) this trip's vibe + brief, (3) couple defaults (budget/vibe/dietary/cuisines/activities). **Walkability is a hard constraint**, not a ranked preference.
- **No emojis** in code. **Sparse comments** — clear names over comments. **European date order** where dates display (not relevant to this slice).
- **Restaurants only** — this slice adds no other discovery categories.
- Spec: `docs/superpowers/specs/2026-07-07-discovery-reads-trip-profile-slice3-design.md`.

---

### Task 1: `getTripProfile(tripId)` query

**Files:**
- Modify: `src/lib/trips/queries.ts`

**Interfaces:**
- Consumes: existing `createClient`, `parseTripProfile`, `TripProfile` (already imported at the top of the file).
- Produces: `getTripProfile(tripId: string): Promise<TripProfile>` — the route (Task 2) calls it.

- [ ] **Step 1: Add the query**

Append to the end of `src/lib/trips/queries.ts`:

```ts
/** The trip's profile (headline/vibe/who/brief) by id, RLS-scoped. Returns an
 * empty profile when the trip is missing or unreadable. Used by the discovery
 * route, which knows the trip id but not the slug. */
export async function getTripProfile(tripId: string): Promise<TripProfile> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("trip_profile")
    .eq("id", tripId)
    .maybeSingle()
  return parseTripProfile(data?.trip_profile)
}
```

- [ ] **Step 2: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean (new exported function, no callers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/queries.ts
git commit -m "feat(discovery): add getTripProfile(tripId) query (slice 3)"
```

---

### Task 2: Extend `RestaurantQuery` + populate it in the route

**Files:**
- Modify: `src/lib/ai/restaurant-discovery-types.ts`
- Modify: `src/app/api/ai/discover/route.ts`

**Interfaces:**
- Consumes: `getTripProfile` (Task 1); existing `getDiningPreferences` (now returns `activities`), `EMPTY_TRIP_PROFILE` (from `@/lib/trips/trip-profile-types`).
- Produces: `RestaurantQuery` with fields `activities: string[]`, `trip: { vibe: string[]; brief: string }`, `craving: string`, `near: string`, `walkable: boolean`. Task 3 (prompt) reads these.

- [ ] **Step 1: Extend the `RestaurantQuery` type**

In `src/lib/ai/restaurant-discovery-types.ts`, replace the `RestaurantQuery` interface with:

```ts
/** What we ask Claude to find — a trip's facts, the couple's tastes, and the
 * in-the-moment inputs (craving + walkable-from-anchor). */
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
```

- [ ] **Step 2: Rewrite the route to load the profile and build the enriched query**

Replace the entire contents of `src/app/api/ai/discover/route.ts` with:

```ts
import { NextResponse } from "next/server"

import { searchRestaurants } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripProfile } from "@/lib/trips/queries"
import { EMPTY_TRIP_PROFILE } from "@/lib/trips/trip-profile-types"
import type { RestaurantQuery } from "@/lib/ai/restaurant-discovery-types"

// POST /api/ai/discover: one real web-search-backed Claude call returning a
// cited restaurant shortlist. AI-mode-gated (the `ai` cookie) and auth-gated
// (the proxy requires a session). The body carries what a door knows —
// destination + when + optional tripId + the in-the-moment inputs; the couple's
// dining preferences and the trip profile are loaded server-side (server
// authoritative) and merged into the query.
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

    const prefs = await getDiningPreferences(workspace.id)
    const tripId = String(body.tripId ?? "").trim()
    const profile = tripId ? await getTripProfile(tripId) : EMPTY_TRIP_PROFILE

    const query: RestaurantQuery = {
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

    const suggestions = await searchRestaurants(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean. The route now sets every new `RestaurantQuery` field; `discoveryPrompt` still reads only the original fields (extra data is ignored), so behavior is unchanged this task.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/restaurant-discovery-types.ts src/app/api/ai/discover/route.ts
git commit -m "feat(discovery): load trip profile + in-the-moment inputs into the query (slice 3)"
```

---

### Task 3: Prompt + system read the new signals (`claude.ts`)

**Files:**
- Modify: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: the extended `RestaurantQuery` (Task 2).
- Produces: no new exports — `discoveryPrompt` (internal) and `DISCOVERY_SYSTEM` now use craving / near / walkable / activities / trip.

- [ ] **Step 1: Append the two precedence sentences to `DISCOVERY_SYSTEM`**

In `src/lib/ai/claude.ts`, replace the `DISCOVERY_SYSTEM` constant with (adds the final two sentences; the rest is unchanged):

```ts
const DISCOVERY_SYSTEM =
  "You help a couple find restaurants for a trip. Never ask the user questions " +
  "or reply conversationally — you cannot receive a reply. On every request you " +
  "MUST: (1) use the web_search tool to find real, currently-open restaurants " +
  "near the destination, then (2) call propose_restaurants with 3 to 4 options. " +
  "If their preferences are sparse, search for well-regarded, broadly-appealing " +
  "restaurants for that destination anyway — do not ask for more detail. Every " +
  "suggestion must come from a real search result and include that result's URL " +
  "as sourceUrl. Never invent a restaurant, a URL, or an exact price. Keep each " +
  "'why' to one sentence. When choosing, weight what they are in the mood for " +
  "right now first, then this trip's vibe and brief, then the couple's general " +
  "tastes. If told they are on foot, only propose places genuinely within " +
  "walking distance of the given anchor — never somewhere that needs a car or a " +
  "long ride."
```

- [ ] **Step 2: Rewrite `discoveryPrompt` to render the new blocks**

Replace the `discoveryPrompt` function with:

```ts
function discoveryPrompt(query: RestaurantQuery): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const anchor = query.near || query.destination
  const tripLines = [
    list("This trip's vibe", query.trip.vibe),
    query.trip.brief ? `Trip brief: ${query.trip.brief}.` : "",
  ].filter(Boolean)
  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    query.craving ? `Right now they are in the mood for: ${query.craving}.` : "",
    query.walkable
      ? `They are on foot — only suggest places within easy walking distance of ${anchor}.`
      : query.near
        ? `Prefer places near ${query.near}.`
        : "",
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
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(discovery): prompt + system weight craving, trip profile, walkability (slice 3)"
```

---

### Task 4: On-the-road door inputs (`find-a-place.tsx`)

**Files:**
- Modify: `src/app/on-the-road/find-a-place.tsx`

**Interfaces:**
- Consumes: the route accepts `{ tripId, craving, near, walkable }` (Task 2). `tripId` is already a prop on this component.
- Produces: user-facing UI; nothing depends on it.

- [ ] **Step 1: Add the three state fields**

In `src/app/on-the-road/find-a-place.tsx`, add these three `useState`s alongside the existing ones (after `const [time, setTime] = React.useState("")`):

```tsx
  const [craving, setCraving] = React.useState("")
  const [near, setNear] = React.useState(destination)
  const [walkable, setWalkable] = React.useState(true)
```

- [ ] **Step 2: Send the new fields in the request body**

In the `find` function, replace the `body:` line:

```tsx
        body: JSON.stringify({
          destination,
          when: mealWhen(activeMeal),
          tripId,
          craving: craving.trim(),
          near: near.trim(),
          walkable,
        }),
```

- [ ] **Step 3: Render the inputs above the find button**

Replace the `suggestions === null ? (` branch's button block. The current code is:

```tsx
      {suggestions === null ? (
        <button
          type="button"
          onClick={find}
          disabled={loading}
          className="mt-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? "searching…" : `find ${activeMeal}`}
        </button>
      ) : suggestions.length === 0 ? (
```

Replace it with:

```tsx
      {suggestions === null ? (
        <div className="mt-2 flex flex-col gap-2">
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
            {loading ? "searching…" : `find ${activeMeal}`}
          </button>
        </div>
      ) : suggestions.length === 0 ? (
```

- [ ] **Step 4: Lint and build**

Run: `pnpm lint`
Expected: no new errors (no unused vars — all three states are used).
Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/on-the-road/find-a-place.tsx
git commit -m "feat(discovery): on-the-road door adds craving, near, walkable (slice 3)"
```

---

### Task 5: Planning door inputs (`find-a-place-planning.tsx`)

**Files:**
- Modify: `src/app/trips/[slug]/find-a-place-planning.tsx`

**Interfaces:**
- Consumes: the route accepts `{ tripId, craving, near, walkable }` (Task 2). `tripId` and `locations` are already props.
- Produces: user-facing UI; nothing depends on it.

- [ ] **Step 1: Add the three state fields**

In `src/app/trips/[slug]/find-a-place-planning.tsx`, add these alongside the existing `useState`s (after `const [time, setTime] = React.useState("")`):

```tsx
  const [craving, setCraving] = React.useState("")
  const [near, setNear] = React.useState(locations[0]?.name ?? "")
  const [walkable, setWalkable] = React.useState(false)
```

(All hooks stay above the existing `if (!enabled || locations.length === 0) return null` early return — `locations[0]?.name ?? ""` is safe when the list is empty.)

- [ ] **Step 2: Reset `near` when the location changes**

Replace the location `<select>`'s `onChange`:

```tsx
          onChange={(e) => {
            setLocId(e.target.value)
            setNear(locations.find((l) => l.id === e.target.value)?.name ?? "")
            setSuggestions(null)
            setError(null)
            setConfirmingName(null)
          }}
```

- [ ] **Step 3: Send the new fields in the request body**

In the `find` function, replace the `body:` line:

```tsx
        body: JSON.stringify({
          destination: location.name,
          when: "dinner",
          tripId,
          craving: craving.trim(),
          near: near.trim(),
          walkable,
        }),
```

- [ ] **Step 4: Render the inputs in the control row**

The current control row is:

```tsx
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={location.id}
          onChange={(e) => {
            setLocId(e.target.value)
            setNear(locations.find((l) => l.id === e.target.value)?.name ?? "")
            setSuggestions(null)
            setError(null)
            setConfirmingName(null)
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
```

Insert the craving input, near input, and walkable label **between the `</select>` and the `<button>`**:

```tsx
        <input
          type="text"
          value={craving}
          onChange={(e) => setCraving(e.target.value)}
          placeholder="what do you feel like?"
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
        />
        <input
          type="text"
          value={near}
          onChange={(e) => setNear(e.target.value)}
          placeholder="near…"
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
        />
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <input
            type="checkbox"
            checked={walkable}
            onChange={(e) => setWalkable(e.target.checked)}
          />
          walkable
        </label>
```

- [ ] **Step 5: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/find-a-place-planning.tsx"
git commit -m "feat(discovery): planning door adds craving, near, walkable (slice 3)"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add the TODO entry**

Prepend a status paragraph under the "Two-level profile" section of `docs/TODO.md` noting slice 3 built: discovery now reads the trip profile (vibe + brief) and couple activities via a new `getTripProfile(tripId)`; both doors gained the three in-the-moment inputs (craving, near, walkable) with mode defaults (walkable on for on-the-road, off for planning); precedence is prompt-level (craving > trip > couple; walkability a hard constraint); no migration/deps. Reference the spec and plan. Note live verification (a real preference-shift search) needs a logged-in session with AI mode on. Match the format of the existing slice entries.

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: mark discovery reads trip profile + in-the-moment (slice 3) built"
```

---

## Self-Review

**Spec coverage:**
- Signal priority + walkability constraint → Task 3 (system sentences) + Task 2 (fields). Covered.
- `getTripProfile(tripId)` → Task 1. Covered.
- `RestaurantQuery` additions → Task 2 Step 1. Covered.
- Route body + load profile + build query → Task 2 Step 2. Covered.
- `discoveryPrompt` blocks + `DISCOVERY_SYSTEM` → Task 3. Covered.
- On-the-road door (near prefills destination, walkable default true) → Task 4. Covered.
- Planning door (near prefills location.name, resets on change, walkable default false) → Task 5. Covered.
- Roadmap note → already recorded in the vision doc when the spec landed; Task 6 covers the TODO log.
- Deferred items (ratings, who/headline, meal picker, other categories) → correctly out of scope.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. Task 6 is prose-described doc text (house-format log entry), not a code step.

**Type consistency:** `RestaurantQuery` fields defined in Task 2 (`activities`, `trip.vibe`, `trip.brief`, `craving`, `near`, `walkable`) are exactly the names read in Task 3's prompt and set in Task 2's route and the door bodies (Tasks 4/5). `getTripProfile(tripId): Promise<TripProfile>` defined in Task 1 is called with the same signature in Task 2. `EMPTY_TRIP_PROFILE` and `parseTripProfile` are existing exports. Consistent.

**Build-green ordering:** Task 1 (new fn, no callers) → Task 2 (type + sole constructor updated together) → Task 3 (consumer) → Tasks 4/5 (doors send optional fields the route already accepts) → Task 6 (docs). No task leaves an intermediate broken build.
