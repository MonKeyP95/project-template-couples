# Suggest Harness (Scope Picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a scope picker in front of `/ suggest` (page default / trip overview / a specific day / free text) so a suggestion can be aimed instead of blind.

**Architecture:** Add a `SuggestScope` union to the shared types. The server action `suggestForSurface` gains a third `scope` arg and dispatches to per-scope prompt builders (page falls through to today's per-surface prompt, unchanged). A small lazy action `getSuggestDays` feeds the day picker. The client `SuggestLine` inside `assistant-block.tsx` grows a chip row + day picker + free-text input and remembers the last scope for "another". `claude.ts` is untouched — `generateSuggestion` already takes an arbitrary prompt.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Server Actions, Tailwind v4. Anthropic call unchanged.

## Global Constraints

- **Suggest-only invariant:** the suggest path reads context and writes nothing; no web_search. Do not touch `claude.ts`.
- **No tests in this repo.** Validate every task with `pnpm build` and `pnpm lint` (both clean) plus the task's in-app smoke check. Do not invent a test command.
- **No emojis** in code, prompts, or logs.
- **Client/types split rule:** `"use client"` files import types from `*-types.ts`, never from `*-queries.ts` (which pull `next/headers`). `SuggestScope`/`SuggestDay` live in `suggestion-types.ts`.
- **European date order:** any displayed date is day-before-month ("12 Jun"), never month-first.
- **Mode is dates-driven:** on the road = device-local today within `[trip.startDate, trip.endDate]`; otherwise planning. No toggle.
- **Sparse comments, short functions, clear names.** No defensive/speculative code.

---

## File Structure

- `src/lib/ai/suggestion-types.ts` — **modify.** Add `SuggestScope` union and `SuggestDay` interface. Client-safe (no server imports).
- `src/lib/ai/suggestion-actions.ts` — **modify.** `suggestForSurface` takes `scope`; add `buildScopedPrompt` + three per-scope builders; add `getSuggestDays`.
- `src/components/assistant-block.tsx` — **modify.** Rewrite the `SuggestLine` sub-component only; the rest of the block is untouched.
- `src/lib/ai/claude.ts` — **untouched.**

---

## Task 1: Server seam — scope types, scoped prompts, day list

**Files:**
- Modify: `src/lib/ai/suggestion-types.ts`
- Modify: `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Consumes (all already imported in `suggestion-actions.ts`): `getTripBySlug(workspaceId, slug) -> { id, name, country, startDate, endDate, plannedBudgetCents, ... }`; `getItineraryLocations(tripId) -> { name, ... }[]`; `getItineraryDays(tripId) -> ItineraryDay[]` where `ItineraryDay` has `dayDate: string`, `dow: string`, `dom: string`, `mon: string`, `title: string`, `events: { time: string|null; text: string }[]`; `getBudgetItems(tripId) -> { category, subject, amountCents }[]`; `getPackingItems(tripId) -> { label }[]`; `localToday() -> "yyyy-mm-dd"`; `generateSuggestion(prompt) -> Suggestion`.
- Produces (Task 2 relies on these exact signatures):
  - `type SuggestScope = { kind: "page" } | { kind: "trip" } | { kind: "day"; date: string } | { kind: "free"; text: string }`
  - `interface SuggestDay { date: string; label: string; isToday: boolean }`
  - `suggestForSurface(surface: SurfaceKey, tripSlug?: string, scope?: SuggestScope): Promise<{ suggestion?: Suggestion; error?: string }>` (scope defaults to `{ kind: "page" }`)
  - `getSuggestDays(tripSlug: string): Promise<{ days: SuggestDay[]; defaultDate: string | null }>` (`defaultDate` = today when on the road and today is a real day, else null)

- [ ] **Step 1: Add the scope types**

In `src/lib/ai/suggestion-types.ts`, append below the existing `Suggestion` interface:

```ts
/** How the user aimed the suggestion. `page` = the per-surface default. */
export type SuggestScope =
  | { kind: "page" }
  | { kind: "trip" }
  | { kind: "day"; date: string }
  | { kind: "free"; text: string }

/** A pickable day for the "a specific day" scope. */
export interface SuggestDay {
  /** yyyy-mm-dd. */
  date: string
  /** European-order label, e.g. "FRI 12 Jun". */
  label: string
  isToday: boolean
}
```

- [ ] **Step 2: Import the new types in the action file**

In `src/lib/ai/suggestion-actions.ts`, extend the existing type import:

```ts
import type { SurfaceKey, Suggestion, SuggestScope, SuggestDay } from "@/lib/ai/suggestion-types"
```

- [ ] **Step 3: Add the scoped prompt builders**

In `src/lib/ai/suggestion-actions.ts`, add these functions **above** `suggestForSurface` (after the existing `buildPrompt`). They reuse `EUR`, `tripLine`, and the already-imported queries.

```ts
const RESTRAINT =
  "Surface the single most valuable thing. Do not assume every day needs a " +
  "dinner or every gap needs filling; some open time is intentional."

/** Whole-trip overview prompt: locations, itinerary fill, budget, packing. */
async function buildTripPrompt(
  tripId: string,
  header: string,
  modeLine: string,
  onRoad: boolean,
  plannedBudgetCents: number | null,
): Promise<string> {
  const locations = await getItineraryLocations(tripId)
  const days = await getItineraryDays(tripId)
  const budget = await getBudgetItems(tripId)
  const packing = await getPackingItems(tripId)
  const locNames = locations.map((l) => l.name).join(", ") || "none yet"
  const planned = days.filter((d) => d.events.length > 0).length
  return [
    `${modeLine} Trip: ${header}. Scope: whole-trip overview.`,
    `Locations: ${locNames}.`,
    `Itinerary: ${days.length} days, ${planned} with something planned.`,
    plannedBudgetCents
      ? `Planned budget: ${EUR(plannedBudgetCents)}, ${budget.length} line items.`
      : `No overall budget set; ${budget.length} line items.`,
    `Packing list: ${packing.length} items.`,
    onRoad
      ? "Suggest the single most valuable thing for the rest of the trip."
      : "Suggest the single most valuable thing to plan next across the whole trip.",
    RESTRAINT,
  ].join(" ")
}

/** One-day prompt. Returns null if the date is not a real itinerary day. */
async function buildDayPrompt(
  tripId: string,
  header: string,
  modeLine: string,
  date: string,
): Promise<string | null> {
  const day = (await getItineraryDays(tripId)).find((d) => d.dayDate === date)
  if (!day) return null
  const events = day.events
    .map((e) => `${e.time ? `${e.time} ` : ""}${e.text}`)
    .join(", ")
  return [
    `${modeLine} Trip: ${header}. Scope: the day ${date} (${day.title}).`,
    events ? `Planned that day: ${events}.` : "Nothing planned that day yet.",
    "Suggest one worthwhile thing for that day.",
    RESTRAINT,
  ].join(" ")
}

/** Free-text prompt: the couple's own request, grounded in trip context. */
function buildFreePrompt(header: string, modeLine: string, text: string): string {
  return [
    `${modeLine} Trip: ${header}. Scope: the couple's own request.`,
    `They asked: "${text}".`,
    "Give one concrete, specific suggestion answering that request, grounded in the trip context.",
    RESTRAINT,
  ].join(" ")
}

/** Dispatch by scope. `page` falls through to the per-surface prompt (unchanged);
 * trip/day/free need a trip and add mode framing. Returns null when a required
 * trip is missing. */
async function buildScopedPrompt(
  surface: SurfaceKey,
  workspaceId: string,
  tripSlug: string | undefined,
  scope: SuggestScope,
): Promise<string | null> {
  if (scope.kind === "page") return buildPrompt(surface, workspaceId, tripSlug)
  if (!tripSlug) return null
  const trip = await getTripBySlug(workspaceId, tripSlug)
  if (!trip) return null
  const header = tripLine(trip.name, trip.country, trip.startDate, trip.endDate)
  const today = await localToday()
  const onRoad =
    trip.startDate != null &&
    trip.endDate != null &&
    today >= trip.startDate &&
    today <= trip.endDate
  const modeLine = onRoad
    ? `The couple is on the road; today is ${today}.`
    : "The couple is planning, before the trip."
  if (scope.kind === "trip")
    return buildTripPrompt(trip.id, header, modeLine, onRoad, trip.plannedBudgetCents)
  if (scope.kind === "day")
    return buildDayPrompt(trip.id, header, modeLine, scope.date)
  return buildFreePrompt(header, modeLine, scope.text)
}
```

- [ ] **Step 4: Route `suggestForSurface` through the dispatcher**

In `src/lib/ai/suggestion-actions.ts`, replace the existing `suggestForSurface` body so it accepts a scope and calls `buildScopedPrompt`:

```ts
export async function suggestForSurface(
  surface: SurfaceKey,
  tripSlug?: string,
  scope: SuggestScope = { kind: "page" },
): Promise<{ suggestion?: Suggestion; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  try {
    const prompt = await buildScopedPrompt(surface, workspace.id, tripSlug, scope)
    if (!prompt) return { error: "No trip in context." }
    const suggestion = await generateSuggestion(prompt)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
```

- [ ] **Step 5: Add the lazy day-list action**

In `src/lib/ai/suggestion-actions.ts`, append at the end of the file:

```ts
/** Days for the "a specific day" picker, plus the default date (today when on
 * the road and today is a real itinerary day, else null). AI-gated + guarded. */
export async function getSuggestDays(
  tripSlug: string,
): Promise<{ days: SuggestDay[]; defaultDate: string | null }> {
  if (!(await isAiEnabled())) return { days: [], defaultDate: null }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { days: [], defaultDate: null }
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return { days: [], defaultDate: null }

  const today = await localToday()
  const days: SuggestDay[] = (await getItineraryDays(trip.id)).map((d) => ({
    date: d.dayDate,
    label: `${d.dow} ${d.dom} ${d.mon}`,
    isToday: d.dayDate === today,
  }))
  const defaultDate = days.some((d) => d.isToday) ? today : null
  return { days, defaultDate }
}
```

- [ ] **Step 6: Build and lint**

Run: `pnpm build && pnpm lint`
Expected: both succeed. The old 2-arg `suggestForSurface(surface, tripSlug)` call in `assistant-block.tsx` still type-checks because `scope` defaults.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/suggestion-types.ts src/lib/ai/suggestion-actions.ts
git commit -m "feat(assistant): scoped suggest prompts + day-list action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Client — scope chip row, day picker, free-text input

**Files:**
- Modify: `src/components/assistant-block.tsx` (the `SuggestLine` function only)

**Interfaces:**
- Consumes from Task 1: `suggestForSurface(surface, tripSlug, scope)`, `getSuggestDays(tripSlug)`, types `SuggestScope`, `SuggestDay`.
- Produces: nothing new for other files; `SuggestLine`'s props are unchanged (`{ surface, tripSlug }`), so `AssistantBlock` and every page that renders it stay as-is.

- [ ] **Step 1: Extend the imports**

In `src/components/assistant-block.tsx`, update the two suggestion imports:

```ts
import { suggestForSurface, getSuggestDays } from "@/lib/ai/suggestion-actions"
import type { SurfaceKey, Suggestion, SuggestScope, SuggestDay } from "@/lib/ai/suggestion-types"
```

- [ ] **Step 2: Replace the `SuggestLine` component**

Replace the entire existing `SuggestLine` function with the version below. It keeps the collapsed `/ suggest` entry, adds a chip row, a lazily-loaded mode-aware day picker, a one-line free-text input, and remembers the last scope so "another" re-runs it.

```tsx
type Stage = "idle" | "menu" | "day" | "free"

/** On-demand suggestion with a scope picker. Press "/ suggest" to reveal scope
 * chips; page/trip run at once, "a day" opens a mode-aware day picker, "free
 * text" opens a one-line input. Result renders in SuggestionCard; "another"
 * re-runs the same scope. Suggest-only: no writes. */
function SuggestLine({
  surface,
  tripSlug,
}: {
  surface: SurfaceKey
  tripSlug?: string
}) {
  const [stage, setStage] = React.useState<Stage>("idle")
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lastScope, setLastScope] = React.useState<SuggestScope>({ kind: "page" })
  const [days, setDays] = React.useState<SuggestDay[]>([])
  const [daysLoading, setDaysLoading] = React.useState(false)
  const [freeText, setFreeText] = React.useState("")

  const run = React.useCallback(
    async (scope: SuggestScope) => {
      setBusy(true)
      setError(null)
      setLastScope(scope)
      const res = await suggestForSurface(surface, tripSlug, scope)
      if (res.suggestion) {
        setSuggestion(res.suggestion)
        setStage("idle")
      } else {
        setError(res.error ?? "Couldn't reach the assistant.")
      }
      setBusy(false)
    },
    [surface, tripSlug],
  )

  const openDayPicker = React.useCallback(async () => {
    if (!tripSlug) return
    setStage("day")
    setDaysLoading(true)
    const { days } = await getSuggestDays(tripSlug)
    setDays(days)
    setDaysLoading(false)
  }, [tripSlug])

  function reset() {
    setSuggestion(null)
    setError(null)
    setFreeText("")
    setStage("idle")
  }

  // Result card.
  if (suggestion) {
    return (
      <SuggestionCard
        label={suggestion.label}
        applyLabel={busy ? "thinking..." : "another"}
        dismissLabel="dismiss"
        onApply={() => run(lastScope)}
        onDismiss={reset}
      >
        {suggestion.body}
      </SuggestionCard>
    )
  }

  const chip =
    "font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss disabled:opacity-60"

  // Collapsed entry.
  if (stage === "idle") {
    return (
      <div>
        <button type="button" onClick={() => setStage("menu")} className={chip}>
          / suggest
        </button>
        {error ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-clay">{error}</p>
        ) : null}
      </div>
    )
  }

  // Day picker.
  if (stage === "day") {
    return (
      <div className="flex flex-col gap-2">
        {daysLoading ? (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">
            loading days...
          </span>
        ) : days.length === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">No days yet.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                disabled={busy}
                onClick={() => run({ kind: "day", date: d.date })}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] disabled:opacity-60 ${
                  d.isToday
                    ? "border-moss text-moss"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
                {d.isToday ? " · today" : ""}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setStage("menu")}
          className="self-start font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          back
        </button>
      </div>
    )
  }

  // Free-text input.
  if (stage === "free") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeText.trim() && !busy)
                run({ kind: "free", text: freeText.trim() })
            }}
            placeholder="a sunny spot for a drink..."
            className="flex-1 border-0 border-b border-rule bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />
          <button
            type="button"
            disabled={busy || freeText.trim() === ""}
            onClick={() => run({ kind: "free", text: freeText.trim() })}
            className="rounded-md bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {busy ? "..." : "go"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setStage("menu")}
          className="self-start font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          back
        </button>
      </div>
    )
  }

  // Scope menu. Trip-overview and a-day only when a trip is in context.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" disabled={busy} onClick={() => run({ kind: "page" })} className={chip}>
        {busy && lastScope.kind === "page" ? "thinking..." : "this page"}
      </button>
      {tripSlug ? (
        <>
          <button type="button" disabled={busy} onClick={() => run({ kind: "trip" })} className={chip}>
            {busy && lastScope.kind === "trip" ? "thinking..." : "trip overview"}
          </button>
          <button type="button" disabled={busy} onClick={openDayPicker} className={chip}>
            a day
          </button>
        </>
      ) : null}
      <button type="button" disabled={busy} onClick={() => setStage("free")} className={chip}>
        free text
      </button>
      {error ? (
        <p className="w-full text-[12.5px] leading-snug text-clay">{error}</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Build and lint**

Run: `pnpm build && pnpm lint`
Expected: both succeed. Watch for the React-19 lint gotchas (JSX literal text, no reset-via-effect) — this component uses none.

- [ ] **Step 4: In-app smoke check**

Run: `pnpm dev`, open a real trip, expand the assistant block on several surfaces. Confirm:
- Budget/packing/notes: `/ suggest` -> chips show `this page`, `trip overview`, `a day`, `free text`.
- `this page` matches today's behavior (one card); `another` re-runs page scope; `dismiss` returns to `/ suggest`.
- `trip overview` returns one holistic suggestion, not a fill-everything list.
- `a day` (planning): lists the itinerary days in day-before-month order; picking one returns a day suggestion. On the road: today's chip is marked "· today".
- `free text`: typing a request + go/Enter returns one aimed suggestion.
- Home / checklists (no `tripSlug`): only `this page` and `free text` chips appear.

(If dev hits the Turbopack `0xc0000142` panic on Windows: stop, delete `.next/`, restart — not a code bug.)

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant-block.tsx
git commit -m "feat(assistant): scope picker for / suggest (page/trip/day/free)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Docs — TODO + DECISIONS

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update TODO**

In `docs/TODO.md`, mark the suggest-harness slice done (match the file's existing style/section for assistant slices) with a one-line entry: "Suggest scope picker (page / trip overview / a specific day / free text) shipped; suggest-only, no door/chat merge."

- [ ] **Step 2: Append a DECISIONS row**

In `docs/DECISIONS.md`, append a row capturing the two non-obvious calls: (1) suggest and the `⌕` door stay separate engines (introspective vs. web discovery) — no merge; (2) overview restraint is a prompt guardrail now, with a learned/settable density preference deferred to the behavior-harness slice.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: suggest harness shipped (TODO + DECISIONS)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deferred (from the spec — do not build here)

1. **Density / restraint preference harness** — a couple-level setting or learned signal for how much they want planned vs. left open, consumed by the trip/day prompts. Part of the behavior-harness slice (vision #2).
2. **Suggest ⟷ ask unification** (vision #4) — whether free-text suggest and chat converge; intent-routing inward-suggest vs. outward-discovery.
3. **Suggest ⟷ door merge** — reconsidered and dropped; revisit only if the two front doors prove confusing in use.

---

## Self-Review

- **Spec coverage:** scope picker (Task 2) ✓; page default unchanged (Task 1 Step 3–4, `buildPrompt` untouched) ✓; trip overview / day / free-text prompts (Task 1 Step 3) ✓; mode-aware day default (Task 1 Step 5 `defaultDate`, Task 2 today chip) ✓; scopes hidden when data absent (Task 2 `tripSlug` gate) ✓; restraint guardrail (Task 1 `RESTRAINT`) ✓; "another" re-runs same scope (Task 2 `lastScope`) ✓; door/claude.ts untouched ✓; deferred items recorded ✓.
- **Placeholder scan:** none — every code step shows complete code; docs steps name exact files and the one-liner content.
- **Type consistency:** `SuggestScope`/`SuggestDay` defined in Task 1 Step 1, imported and used verbatim in Tasks 1–2; `suggestForSurface`/`getSuggestDays` signatures match between producer (Task 1) and consumer (Task 2); `getSuggestDays` returns `{ days, defaultDate }` and Task 2 destructures only `days` (defaultDate reserved; `isToday` drives the today chip) — consistent.
