# Discovery On-the-Road Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the on-the-road restaurant-discovery door — a small, meal-aware, AI-mode-gated block on `/on-the-road` that, when today has no event for the current meal, finds cited places near today's location and adds a pick to today in one tap.

**Architecture:** One engine, two front doors (per `docs/superpowers/specs/2026-06-29-restaurant-discovery-design.md` §6). The planning door (Assistant) is separate and unbuilt here. This door reuses the existing `searchRestaurants` engine via the existing `POST /api/ai/discover` route — it sends `{ destination, when }` built from today's location and the inferred meal, renders cited rows, and accepts via the existing `addTodayEvent` server action. A pure helper module does meal inference + the visibility heuristic; one client component renders the affordance; the page wires it in.

**Tech Stack:** Next.js 16 App Router (Server + Client Components), React 19, TypeScript 5, Tailwind v4. No new dependencies.

## Global Constraints

- **No test runner exists.** Per CLAUDE.md ("There are no tests yet; do not invent a test command until one exists"), every task validates with `pnpm lint` then `pnpm build`. The final task adds manual browser verification on a **390px** viewport. There are no `*.test.ts` files.
- **Suggest-only.** Code under `lib/ai` returns data only; all writes happen from explicit user gestures via existing Server Actions (`addTodayEvent`). This door adds nothing under `lib/ai`.
- **Client/server split rule.** A `"use client"` file must not import `next/headers` (directly or transitively). Pure helpers live in plain `*.ts` with no `server-only`/`next/headers` import.
- **AI-mode-gated.** Discovery UI renders only when AI mode is on (`useAiMode().enabled`).
- **No emojis** in code, comments, or copy. Sparse comments; comment only non-obvious WHY.
- **European date order** where dates render (not relevant to this plan's copy, but the rule stands).
- **Grounding:** every suggestion shows its source URL and a "verify hours" nudge; "open now" is only ever a prompt preference, never a rendered guarantee.
- Commit after each task with a `feat(ai):` / `feat:` message ending:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Scope notes (read before starting)

- **Built on the smoke route, no preferences yet.** `POST /api/ai/discover` is currently body-driven (destination + when, defaults for the rest). This door uses it as-is. When slice A (preferences) + B2 (auth'd endpoint) land, the route gains preference loading **server-side**; this door keeps POSTing the same body to the same path, so it needs no rework.
- **Deviation from spec §6 "source URL in the note":** `ItineraryEvent` is `{ time, text }` only — there is no note field, and adding one is an event-model change that is explicitly out of scope. The accepted event text is `"<Meal> · <Name>"`; the source URL is visible in the suggestion row before you add. (Update spec §6 to match after this lands.)
- **Deviation from spec §2 `nearLocationName`/`targetMeal`:** the implemented engine already takes a free-text `when` and a `destination`. We pass `destination` = today's location and `when` = a meal phrase ("dinner tonight"). No new typed fields (YAGNI). (Update spec §2 to match after this lands.)

---

### Task 1: Meal-slot helper (pure)

A dependency-free module: infer the current meal from a `Date`, and decide whether that meal is already on today's plan. Pure so the client component can import it without pulling server modules.

**Files:**
- Create: `src/app/on-the-road/meal-slot.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Meal = "breakfast" | "lunch" | "dinner"`
  - `currentMeal(now: Date): Meal` — `<11:00` breakfast, `<16:00` lunch, else dinner (uses `now.getHours()`, i.e. device-local).
  - `mealLabel(meal: Meal): "Breakfast" | "Lunch" | "Dinner"`
  - `mealWhen(meal: Meal): string` — `"breakfast today" | "lunch today" | "dinner tonight"`.
  - `mealAlreadyPlanned(meal: Meal, eventTexts: string[]): boolean` — case-insensitive: any event text contains the meal word.

- [ ] **Step 1: Write the module**

```ts
// src/app/on-the-road/meal-slot.ts
// Pure helpers for the on-the-road discovery door: which meal is it now, and is
// that meal already on today's plan. No server imports so the client door can
// use it (client/server split rule).

export type Meal = "breakfast" | "lunch" | "dinner"

/** Meal slot for the given moment. Device-local via getHours(). */
export function currentMeal(now: Date): Meal {
  const h = now.getHours()
  if (h < 11) return "breakfast"
  if (h < 16) return "lunch"
  return "dinner"
}

export function mealLabel(meal: Meal): "Breakfast" | "Lunch" | "Dinner" {
  return { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" }[meal]
}

/** Phrase fed to the search engine's free-text `when`. */
export function mealWhen(meal: Meal): string {
  return {
    breakfast: "breakfast today",
    lunch: "lunch today",
    dinner: "dinner tonight",
  }[meal]
}

/** True if any of today's event titles already names this meal. Fuzzy on
 * purpose: a keyword nudge, not a guarantee. */
export function mealAlreadyPlanned(meal: Meal, eventTexts: string[]): boolean {
  return eventTexts.some((t) => t.toLowerCase().includes(meal))
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles clean (the new module is unused so far — that is fine).

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/meal-slot.ts
git commit -m "feat(ai): meal-slot helper for on-the-road discovery door

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The road discovery client component

The on-page affordance. Renders nothing unless AI is on, the component has mounted (so the time-based decision can't mismatch SSR), and the current meal is not already planned. Otherwise shows "find <meal>", which calls the discover route and renders cited rows with one-tap "add to today".

**Files:**
- Create: `src/app/on-the-road/find-a-place.tsx`

**Interfaces:**
- Consumes:
  - From Task 1: `currentMeal`, `mealLabel`, `mealWhen`, `mealAlreadyPlanned`, `Meal`.
  - Existing: `useAiMode` from `@/components/ai-mode`; `addTodayEvent` from `@/lib/trips/actions`; `RestaurantSuggestion` from `@/lib/ai/restaurant-discovery-types` (`{ name, why, area, priceHint, sourceUrl }`).
  - Existing route: `POST /api/ai/discover` with body `{ destination, when }` → `{ suggestions: RestaurantSuggestion[] }` on 200, or `{ error: string }` on non-200.
- Produces:
  - `FindAPlace(props: { tripId: string; tripSlug: string; dayDate: string; dayId: string | null; destination: string; todayEventTexts: string[] }): JSX.Element | null`

- [ ] **Step 1: Write the component**

```tsx
// src/app/on-the-road/find-a-place.tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { addTodayEvent } from "@/lib/trips/actions"
import type { RestaurantSuggestion } from "@/lib/ai/restaurant-discovery-types"
import {
  currentMeal,
  mealAlreadyPlanned,
  mealLabel,
  mealWhen,
  type Meal,
} from "./meal-slot"

export function FindAPlace({
  tripId,
  tripSlug,
  dayDate,
  dayId,
  destination,
  todayEventTexts,
}: {
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
  destination: string
  todayEventTexts: string[]
}) {
  const router = useRouter()
  const { enabled } = useAiMode()
  const [meal, setMeal] = React.useState<Meal | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    RestaurantSuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())

  // Decide the meal on the client after mount: the server has no device clock,
  // so computing during render would risk a hydration mismatch.
  React.useEffect(() => {
    setMeal(currentMeal(new Date()))
  }, [])

  if (!enabled || !meal) return null
  if (mealAlreadyPlanned(meal, todayEventTexts)) return null

  const label = mealLabel(meal)

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, when: mealWhen(meal) }),
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

  function addToToday(s: RestaurantSuggestion) {
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: "",
      text: `${label} · ${s.name}`,
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
    <section className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · suggestion
      </span>
      {suggestions === null ? (
        <button
          type="button"
          onClick={find}
          disabled={loading}
          className="mt-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? "searching…" : `find ${meal}`}
        </button>
      ) : suggestions.length === 0 ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : (
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
                onClick={() => addToToday(s)}
                disabled={added.has(s.name)}
                className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {added.has(s.name) ? "added" : "add to today"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors. (Note: `meal` is narrowed to non-null after the `if (!enabled || !meal) return null` guard; the `find`/`addToToday` closures rely on that narrowing — there should be no "possibly null" error. If lint flags the unused `dayDate`/`dayId` it means the wiring in Task 3 is needed; they are used inside `addToToday`, so no warning is expected.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles clean (component is unused until Task 3 — fine).

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/find-a-place.tsx
git commit -m "feat(ai): on-the-road FindAPlace discovery affordance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the door into the on-the-road page

Render `FindAPlace` directly after the Today section and before `QuickExpense`, passing today's location as the search destination and today's event titles for the visibility heuristic. This is the task that makes the feature visible and is verified in the browser.

**Files:**
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `FindAPlace` from Task 2. Existing page locals: `trip`, `today`, `todayDay`, `locationName` (all already computed in the file).
- Produces: nothing (terminal wiring).

- [ ] **Step 1: Add the import**

In `src/app/on-the-road/page.tsx`, alongside the other `./` imports (near `import { TodayUpcoming } from "./today-upcoming"`), add:

```tsx
import { FindAPlace } from "./find-a-place"
```

- [ ] **Step 2: Compute the door's props**

After the existing `const place = locationName ?? trip.country ?? "On the road"` line, add:

```tsx
const todayEventTexts = todayDay?.events.map((e) => e.text) ?? []
// "On the road" is a UI placeholder, not a place to search — fall back to the
// trip's country/name instead.
const searchDestination = locationName ?? trip.country ?? trip.name
```

- [ ] **Step 3: Render the door between Today and QuickExpense**

In the JSX, immediately after the Today `</section>` (the one containing `<AddTodayEvent .../>`) and before `<QuickExpense`, insert:

```tsx
      <FindAPlace
        tripId={trip.id}
        tripSlug={trip.slug}
        dayDate={today}
        dayId={todayDay?.id ?? null}
        destination={searchDestination}
        todayEventTexts={todayEventTexts}
      />
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 6: Manual verification (390px viewport, AI mode on)**

Prerequisite: there must be a current trip (in `listTripsForWorkspace(...).now`). `ANTHROPIC_API_KEY` must be set for the discover route. Set the `ai` cookie on via the AI toggle in the UI.

Run: `pnpm dev`, open `http://localhost:3000/on-the-road` at a 390px width, and confirm:
- With AI **off**: no "find …" block appears.
- With AI **on** and **no** event whose title contains the current meal word: the moss-accented block shows "find <meal>" (e.g. "find dinner" after 16:00).
- Clicking it shows "searching…", then 3–4 rows, each with name, why, area · price, a "source — verify hours" link, and "add to today". (Expect ~30–60s; the search is real.)
- Clicking "add to today" adds a `"<Meal> · <Name>"` event to Today; after refresh the block hides (the new event now contains the meal word).
- If you already have an event titled e.g. "Dinner with friends", the block does not show in the evening.

- [ ] **Step 7: Commit**

```bash
git add src/app/on-the-road/page.tsx
git commit -m "feat(ai): wire on-the-road discovery door into the day view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§6 of the design):**
- On-page block under Today, AI-mode-gated → Task 3 placement + Task 2 `useAiMode` guard. ✓
- Meal inference from local time → Task 1 `currentMeal` (device-local via the client `new Date()` in Task 2). ✓
- Visibility heuristic (current meal keyword on today's events) → Task 1 `mealAlreadyPlanned` + Task 3 `todayEventTexts`. ✓
- Search near today's location → Task 3 `searchDestination` (location name, fallback trip country/name); Task 2 sends `{ destination, when: mealWhen(meal) }`. ✓
- Cited rows + verify-hours nudge → Task 2 row markup (source link labelled "verify hours"). ✓
- One-tap "add to today" → ordinary event → Task 2 `addToToday` via existing `addTodayEvent`, text `"<Meal> · <Name>"`. ✓
- No-location fallback → Task 3 `locationName ?? trip.country ?? trip.name`. ✓
- Feedback (§5) needs nothing here → accepted pick is an ordinary event. ✓ (out of scope, correctly)
- GPS, preferences, event note field → deliberately out of scope (see Scope notes). ✓

**Placeholder scan:** none — every code step is complete; no TBD/TODO.

**Type consistency:** `Meal`, `currentMeal`, `mealLabel`, `mealWhen`, `mealAlreadyPlanned` defined in Task 1 are consumed with identical names/signatures in Task 2. `RestaurantSuggestion` fields (`name`, `why`, `area`, `priceHint`, `sourceUrl`) match `restaurant-discovery-types.ts`. `addTodayEvent` input matches `AddTodayEventInput` (`tripId`, `tripSlug`, `dayDate`, `dayId`, `time`, `text`). Route body/response match the existing `route.ts`. ✓
