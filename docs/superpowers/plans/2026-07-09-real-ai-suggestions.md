# Real AI Suggestion Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the last mock AI surface — the moss `SuggestionCard` on 7 surfaces — from canned strings to real, on-demand, context-grounded Claude suggestions.

**Architecture:** One seam `generateSuggestion(prompt)` in `claude.ts` (plain `messages.create`, forced `propose_suggestion` tool, no web_search). One `"use server"` action `suggestForSurface(surface, tripSlug?)` loads that surface's context via existing queries, builds a prompt, and calls the seam. The client `AiSuggestion` becomes click-to-reveal (`/ suggest` -> loading -> suggestion + another/dismiss), gated by `useAiMode()`.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, TypeScript 5, Anthropic SDK behind `src/lib/ai/claude.ts`.

## Global Constraints

- **No test framework exists in this repo.** Do NOT invent a test command. Each task's validation is `pnpm lint` + `pnpm build` (both must pass) plus the manual smoke named in the task. (CLAUDE.md: "There are no tests yet.")
- **`lib/ai` is suggest-only.** Nothing under `src/lib/ai/` writes to the DB or imports a server action's write path. It returns data; the caller displays it. This slice writes nothing at all.
- **AI is off by default and cookie-gated** via `isAiEnabled()` (`src/lib/ai/ai-mode.ts`, server) / `useAiMode()` (`src/components/ai-mode.tsx`, client). The action self-gates; the card self-gates.
- **One seam.** All Claude calls live in `src/lib/ai/claude.ts` (`import "server-only"`, module-level `anthropic`, `MODEL = "claude-sonnet-4-6"`). Reuse `MODEL`; do NOT add a model constant.
- **Client components import types from `*-types.ts`, never a server-only module.** `SurfaceKey`/`Suggestion` live in `src/lib/ai/suggestion-types.ts` (pure). `claude.ts` is `server-only` and must never be imported by a client component — the client reaches it only through the action.
- **No new deps, no new vendor, no migration.**
- **No emojis** in code, prompts, or logs. Sparse comments; clear names; short functions. European date order (`en-GB`) anywhere dates render.

## File Structure

**New files:**
- `src/lib/ai/suggestion-types.ts` — pure `SurfaceKey` + `Suggestion` (moved out of `suggestions.ts`).
- `src/lib/ai/suggestion-actions.ts` — `"use server"` `suggestForSurface`, with a private context builder per surface.

**Modified files:**
- `src/lib/ai/claude.ts` — add `SUGGESTION_TOOL`, `SUGGESTION_SYSTEM`, `generateSuggestion`.
- `src/components/ai-suggestion.tsx` — click-to-reveal state machine + `tripSlug?` prop + another/dismiss.
- `src/app/trips/[slug]/{budget,packing,itinerary,notes}-tab.tsx`, `src/app/on-the-road/page.tsx` — pass `tripSlug`.
- `docs/TODO.md`, `docs/DECISIONS.md`.

**Deleted files:**
- `src/lib/ai/suggestions.ts` — its types moved; its mock data + `suggestionFor` deleted (nothing reads them after Task 4).

---

### Task 1: Types module

**Files:**
- Create: `src/lib/ai/suggestion-types.ts`
- Modify: `src/lib/ai/suggestions.ts`

**Interfaces:**
- Produces: `type SurfaceKey = "budget" | "packing" | "itinerary" | "notes" | "home" | "road" | "checklists"`; `interface Suggestion { label: string; body: string }`.

- [ ] **Step 1: Create the pure types module**

Create `src/lib/ai/suggestion-types.ts`:

```ts
// Pure types for AI suggestion cards. No server-only import so the client card,
// the server action, and the claude.ts seam can all share them (the *-types.ts
// split convention).

export type SurfaceKey =
  | "budget"
  | "packing"
  | "itinerary"
  | "notes"
  | "home"
  | "road"
  | "checklists"

export interface Suggestion {
  label: string
  body: string
}
```

- [ ] **Step 2: Re-point `suggestions.ts` at the new types**

In `src/lib/ai/suggestions.ts`, delete the local `SurfaceKey` and `Suggestion` declarations and re-export them from the new module instead, keeping `SUGGESTIONS` and `suggestionFor` for now (they are deleted in Task 4). The top of the file becomes:

```ts
/**
 * Mock for AI suggestions. Superseded by suggestion-actions.ts + claude.ts;
 * kept only until the client stops importing it (deleted in Task 4).
 */

import type { SurfaceKey, Suggestion } from "./suggestion-types"

export type { SurfaceKey, Suggestion }

const SUGGESTIONS: Record<SurfaceKey, Suggestion> = {
```

Leave the rest of `SUGGESTIONS` and `suggestionFor` unchanged.

- [ ] **Step 3: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (`ai-suggestion.tsx` still imports `suggestionFor`/`SurfaceKey` from `suggestions.ts` and keeps working via the re-export.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/suggestion-types.ts src/lib/ai/suggestions.ts
git commit -m "refactor(suggest): extract SurfaceKey/Suggestion to suggestion-types (swap #3)"
```

---

### Task 2: The `generateSuggestion` seam

**Files:**
- Modify: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: module-level `anthropic`, `MODEL`, `Anthropic` (already imported at top of `claude.ts`).
- Produces: `generateSuggestion(prompt: string): Promise<Suggestion>` — plain `messages.create`, forced `propose_suggestion` tool, no web_search. Throws if the model returns no tool block (the action catches it).

- [ ] **Step 1: Add the type import**

At the top of `src/lib/ai/claude.ts`, alongside the existing type imports, add:

```ts
import type { Suggestion } from "./suggestion-types"
```

- [ ] **Step 2: Add the tool, system prompt, and function**

In `src/lib/ai/claude.ts`, after `draftBudgetSeeds` (end of the Budget section) add:

```ts
// --- Suggestions ---

const SUGGESTION_TOOL: Anthropic.Messages.ToolUnion = {
  name: "propose_suggestion",
  description: "Return one short, actionable suggestion for the couple.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      label: {
        type: "string",
        description:
          "A terse header in the app's voice, e.g. '/ suggested' or '/ assistant'.",
      },
      body: {
        type: "string",
        description:
          "One to two sentences: a specific, actionable suggestion grounded in the given context. No preamble.",
      },
    },
    required: ["label", "body"],
  },
}

const SUGGESTION_SYSTEM =
  "You are the in-app assistant for a couple planning and taking trips " +
  "together. Given a surface and its current trip context, propose exactly one " +
  "short, specific, actionable suggestion for that surface. Ground it in the " +
  "context provided; never invent facts (place names, dates, prices) not given. " +
  "Keep the body to one or two sentences. Return only the propose_suggestion tool."

/** One real suggestion for a surface, from a context prompt the caller builds.
 * Plain messages.create, no web_search. Suggest-only: returns text, never
 * writes. Throws when the model returns no tool block. */
export async function generateSuggestion(prompt: string): Promise<Suggestion> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SUGGESTION_SYSTEM,
    tools: [SUGGESTION_TOOL],
    tool_choice: { type: "tool", name: "propose_suggestion" },
    messages: [{ role: "user", content: prompt }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_suggestion",
  )
  if (!proposal) throw new Error("No suggestion returned")
  const input = proposal.input as { label?: string; body?: string }
  return { label: input.label ?? "/ suggested", body: input.body ?? "" }
}
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (`generateSuggestion` is exported but unused until Task 3 — fine.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(suggest): generateSuggestion seam in claude.ts (swap #3)"
```

---

### Task 3: The `suggestForSurface` action

**Files:**
- Create: `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Consumes: `generateSuggestion` (`@/lib/ai/claude`); `isAiEnabled` (`@/lib/ai/ai-mode`); `getCurrentWorkspace` (`@/lib/workspace/queries`); `getTripBySlug` (`@/lib/trips/queries`); `getBudgetItems` (`@/lib/trips/budget-item-queries`); `getPackingItems` (`@/lib/trips/packing-queries`); `getItineraryLocations` (`@/lib/trips/location-queries`); `getTripNotes` (`@/lib/trips/note-queries`); `getItineraryDays` (`@/lib/trips/itinerary-queries`); `listTripsForWorkspace` (`@/lib/trips/list-queries`); `listChecklists` (`@/lib/checklists/queries`); `localToday` (`@/lib/time/local-today`); `SurfaceKey`, `Suggestion` (`@/lib/ai/suggestion-types`).
- Produces: `suggestForSurface(surface: SurfaceKey, tripSlug?: string): Promise<{ suggestion?: Suggestion; error?: string }>`.

- [ ] **Step 1: Write the action module**

Create `src/lib/ai/suggestion-actions.ts`:

```ts
"use server"

import { generateSuggestion } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { getPackingItems } from "@/lib/trips/packing-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripNotes } from "@/lib/trips/note-queries"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { listChecklists } from "@/lib/checklists/queries"
import { localToday } from "@/lib/time/local-today"
import type { SurfaceKey } from "@/lib/ai/suggestion-types"

const EUR = (cents: number) => `EUR ${Math.round(cents / 100)}`

/** Short "Name (Country), dd/mm/yyyy-dd/mm/yyyy" trip line. */
function tripLine(name: string, country: string | null, start: string | null, end: string | null): string {
  const where = country ? `${name} (${country})` : name
  const when = start ? ` ${start}${end && end !== start ? ` to ${end}` : ""}` : ""
  return `${where}${when}`
}

/** Build the per-surface context prompt. Returns null when required trip data
 * is missing (the caller turns that into a soft error). */
async function buildPrompt(
  surface: SurfaceKey,
  workspaceId: string,
  tripSlug: string | undefined,
): Promise<string | null> {
  // Workspace-level surfaces first (no tripSlug needed).
  if (surface === "home") {
    const buckets = await listTripsForWorkspace(workspaceId)
    const hero = buckets.now[0] ?? buckets.upcoming[0]
    if (!hero) {
      return "Surface: home. The couple is planning but has no active or upcoming trip yet. Suggest one first planning step (e.g. start a trip or a dream)."
    }
    return [
      "The couple is planning. Surface: home (the landing page).",
      `Their next trip: ${tripLine(hero.name, hero.country, hero.startDate, hero.endDate)}.`,
      "Suggest one concrete next planning step for that trip.",
    ].join(" ")
  }

  if (surface === "checklists") {
    const lists = await listChecklists(workspaceId)
    const names = lists.map((l) => `${l.name} (${l.done}/${l.total})`).join(", ")
    return [
      "The couple is preparing reusable packing checklists. Surface: checklists.",
      lists.length ? `Their checklists: ${names}.` : "They have no checklists yet.",
      "Suggest one useful checklist to create or an item they likely forgot.",
    ].join(" ")
  }

  // Trip-scoped surfaces require a slug + trip.
  if (!tripSlug) return null
  const trip = await getTripBySlug(workspaceId, tripSlug)
  if (!trip) return null
  const header = tripLine(trip.name, trip.country, trip.startDate, trip.endDate)

  if (surface === "budget") {
    const items = await getBudgetItems(trip.id)
    const lines = items
      .map((i) => `${i.category}: ${i.subject} ${EUR(i.amountCents)}`)
      .join("; ")
    return [
      `The couple is planning ${header}. Surface: budget.`,
      trip.plannedBudgetCents ? `Planned budget: ${EUR(trip.plannedBudgetCents)}.` : "No overall budget set yet.",
      items.length ? `Line items: ${lines}.` : "No budget line items yet.",
      "Suggest one budget gap, missing cost, or adjustment.",
    ].join(" ")
  }

  if (surface === "packing") {
    const items = await getPackingItems(trip.id)
    const labels = items.map((i) => i.label).join(", ")
    return [
      `The couple is planning ${header}. Surface: packing.`,
      items.length ? `Already on the list: ${labels}.` : "The packing list is empty.",
      "Suggest one item they likely need for this destination and season but have not listed.",
    ].join(" ")
  }

  if (surface === "itinerary") {
    const locations = await getItineraryLocations(trip.id)
    const names = locations.map((l) => l.name).join(", ")
    return [
      `The couple is planning ${header}. Surface: itinerary.`,
      locations.length ? `Locations planned: ${names}.` : "No locations planned yet.",
      "Suggest one itinerary idea or a gap worth filling.",
    ].join(" ")
  }

  if (surface === "notes") {
    const notes = await getTripNotes(trip.id)
    const bodies = notes.map((n) => n.body).join(" | ")
    return [
      `The couple is planning ${header}. Surface: notes.`,
      notes.length ? `Existing notes: ${bodies}.` : "No notes yet.",
      "Suggest one useful thing worth jotting down for this trip.",
    ].join(" ")
  }

  // road: today + next 3 days of the live itinerary.
  const today = await localToday()
  const days = await getItineraryDays(trip.id)
  const horizon = days.filter((d) => d.dayDate >= today).slice(0, 4)
  const horizonLines = horizon
    .map((d) => {
      const events = d.events.map((e) => `${e.time ? `${e.time} ` : ""}${e.text}`).join(", ")
      return `${d.dayDate} ${d.title}${events ? `: ${events}` : ""}`
    })
    .join("; ")
  return [
    `The couple is on the road during ${header}. Surface: on the road. Today is ${today}.`,
    horizon.length ? `Next few days: ${horizonLines}.` : "Nothing scheduled for the next few days.",
    "Suggest one timely thing for today or the next few days.",
  ].join(" ")
}

/** One real suggestion for a surface. AI-gated + workspace-guarded. Suggest-only:
 * reads context, writes nothing. */
export async function suggestForSurface(
  surface: SurfaceKey,
  tripSlug?: string,
): Promise<{ suggestion?: Awaited<ReturnType<typeof generateSuggestion>>; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  try {
    const prompt = await buildPrompt(surface, workspace.id, tripSlug)
    if (!prompt) return { error: "No trip in context." }
    const suggestion = await generateSuggestion(prompt)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
```

Note: `buckets.now` / `buckets.upcoming` come from `TripBuckets` in `list-queries.ts` (fields `now`, `upcoming`, `past`, `dream`, each `TripListItem[]`). If those bucket names differ when you open the file, use the actual field names — the intent is "active trip else soonest upcoming."

- [ ] **Step 2: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (Unused until Task 4 wires the client.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/suggestion-actions.ts
git commit -m "feat(suggest): suggestForSurface action with per-surface context (swap #3)"
```

---

### Task 4: Click-to-reveal client + delete the mock

**Files:**
- Modify: `src/components/ai-suggestion.tsx`
- Delete: `src/lib/ai/suggestions.ts`

**Interfaces:**
- Consumes: `suggestForSurface` (`@/lib/ai/suggestion-actions`); `SurfaceKey`, `Suggestion` (`@/lib/ai/suggestion-types`); `useAiMode` (`@/components/ai-mode`); `SuggestionCard` (`@/components/together`).
- Produces: `AiSuggestion({ surface, tripSlug?, className? })`.

- [ ] **Step 1: Rewrite the component**

Replace the whole of `src/components/ai-suggestion.tsx` with:

```tsx
"use client"

import * as React from "react"

import { SuggestionCard } from "@/components/together"
import { useAiMode } from "@/components/ai-mode"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { SurfaceKey, Suggestion } from "@/lib/ai/suggestion-types"

/** On-demand AI suggestion for a surface. Collapsed to a "/ suggest" affordance
 * until clicked; then one Claude call fills the card, with "another" (regenerate)
 * and "dismiss" (collapse). AI-mode-gated; renders nothing when AI is off. */
export function AiSuggestion({
  surface,
  tripSlug,
  className,
}: {
  surface: SurfaceKey
  tripSlug?: string
  className?: string
}) {
  const { enabled } = useAiMode()
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    const res = await suggestForSurface(surface, tripSlug)
    if (res.suggestion) setSuggestion(res.suggestion)
    else setError(res.error ?? "Couldn't reach the assistant.")
    setBusy(false)
  }, [surface, tripSlug])

  if (!enabled) return null

  if (!suggestion) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg border border-border border-l-[3px] border-l-moss bg-card px-3.5 py-3 text-left font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss disabled:opacity-60"
        >
          {busy ? "thinking..." : "/ suggest"}
        </button>
        {error ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-clay">{error}</p>
        ) : null}
      </div>
    )
  }

  return (
    <SuggestionCard
      label={suggestion.label}
      applyLabel={busy ? "thinking..." : "another"}
      dismissLabel="dismiss"
      onApply={run}
      onDismiss={() => {
        setSuggestion(null)
        setError(null)
      }}
      className={className}
    >
      {suggestion.body}
    </SuggestionCard>
  )
}
```

(Reuses `SuggestionCard`'s existing `applyLabel`/`onApply` slot as the "another" regenerate control — no card change needed. `text-clay` matches the budget drafter's failure note.)

- [ ] **Step 2: Delete the mock module**

```bash
git rm src/lib/ai/suggestions.ts
```

- [ ] **Step 3: Verify nothing else imports it**

Run: `grep -rn "ai/suggestions\"" src/ || echo "clean"`
Expected: `clean` (only `suggestion-types` / `suggestion-actions` are imported now).

- [ ] **Step 4: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai-suggestion.tsx src/lib/ai/suggestions.ts
git commit -m "feat(suggest): click-to-reveal card calling suggestForSurface; drop mock (swap #3)"
```

---

### Task 5: Thread `tripSlug` at the trip call sites

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx:177`
- Modify: `src/app/trips/[slug]/packing-tab.tsx:487`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx:642`
- Modify: `src/app/trips/[slug]/notes-tab.tsx:124`
- Modify: `src/app/on-the-road/page.tsx:107`

**Interfaces:**
- Consumes: each trip tab already destructures a `tripSlug` prop; `on-the-road/page.tsx` has `trip.slug` in scope. `home/page.tsx` and `checklists/page.tsx` need no change (workspace-scoped, no slug).

- [ ] **Step 1: Pass the slug on the five trip surfaces**

Edit each `<AiSuggestion .../>` to add `tripSlug`:

- `budget-tab.tsx`: `<AiSuggestion surface="budget" tripSlug={tripSlug} />`
- `packing-tab.tsx`: `<AiSuggestion surface="packing" tripSlug={tripSlug} />`
- `itinerary-tab.tsx`: `<AiSuggestion surface="itinerary" tripSlug={tripSlug} />`
- `notes-tab.tsx`: `<AiSuggestion surface="notes" tripSlug={tripSlug} />`
- `on-the-road/page.tsx`: `<AiSuggestion surface="road" tripSlug={trip.slug} className="mb-4 block" />` (keep the existing `className`)

(`home/page.tsx` `surface="home"` and `checklists/page.tsx` `surface="checklists"` stay as-is — they resolve their own workspace context.)

- [ ] **Step 2: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Manual smoke — a real suggestion on each mode**

Start `pnpm dev`, sign in, turn AI mode ON (the Assistant panel toggle or `/profile`). Then:
- On a trip's Budget/Packing/Itinerary/Notes tab: the card shows `/ suggest`; click it -> "thinking..." -> a suggestion grounded in that trip's data; "another" returns a different one; "dismiss" collapses back to `/ suggest`.
- On `/on-the-road` (needs an active trip): the card suggests something tied to today + the next few days.
- On `/home` and `/checklists`: `/ suggest` returns a workspace-level suggestion (next trip step / a checklist idea).
- Turn AI mode OFF: the card disappears on every surface.

Expected: real, context-specific text (not the old canned strings), no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx src/app/trips/[slug]/packing-tab.tsx src/app/trips/[slug]/itinerary-tab.tsx src/app/trips/[slug]/notes-tab.tsx src/app/on-the-road/page.tsx
git commit -m "feat(suggest): thread tripSlug to trip + road suggestion cards (swap #3)"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record the slice in TODO.md**

In `docs/TODO.md`, add a `- [x]`-style entry under the current roadmap section (mirror the existing slice entries' one-paragraph format) describing: the third and final mock-to-real swap; suggestion cards now on-demand (click-to-reveal) real Claude via `generateSuggestion` in `claude.ts` + `suggestForSurface` action; all 7 surfaces, mode-aware (planning surfaces read planning data, road reads today + next 3 days); regenerate + dismiss, suggest-only, AI-gated; `suggestions.ts` mock deleted, types in `suggestion-types.ts`; no migration/deps/vendor. Note the deferred items (working apply, persisted dismissal, streaming, the whole-trip "suggest everything" button = Piece 2). Reference the spec + this plan path.

- [ ] **Step 2: Append decision rows to DECISIONS.md**

In `docs/DECISIONS.md`, append rows (match the file's existing format) for:
- Suggestions are **on-demand (click-to-reveal)**, not eager on page load — proactive generation across 7 surfaces would be an unprompted API call on every page view; on-demand is cheapest and faithful to suggest-only.
- One shared action + one seam (Architecture A), not per-surface actions — mirrors the chat/budget swaps, keeps `lib/ai` the single seam.
- Regenerate reuses `SuggestionCard`'s `applyLabel`/`onApply` slot ("another"); "apply" (per-surface writes) deferred to keep suggest-only intact.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record real AI suggestion cards shipped + decisions (swap #3)"
```

---

## Self-Review

**1. Spec coverage:**
- Seam `generateSuggestion`, plain create, no web_search, forced `propose_suggestion` tool, reuse `MODEL`, suggest-only -> Task 2. ✓
- Action `suggestForSurface(surface, tripSlug?)`, AI-gated + workspace-guarded, per-surface context via existing queries, road = today + next 3 days, home/checklists workspace-scoped -> Task 3. ✓
- Client click-to-reveal, `tripSlug` prop, regenerate + dismiss, AI-gated, error note -> Task 4. ✓
- All 7 surfaces; 5 trip + road pass slug, home/checklists don't -> Task 5. ✓
- Types renamed to `suggestion-types.ts`, mock `suggestions.ts` deleted -> Tasks 1 + 4. ✓
- Invariants (AI-gated, suggest-only, one seam, no migration/deps/vendor) -> Global Constraints + honored throughout. ✓
- Docs (TODO + DECISIONS) -> Task 6. ✓
- Deferred items (apply, persisted dismissal, streaming, Piece 2) -> recorded in Task 6. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 6 describes doc prose (acceptable — authorial wording mirroring existing file format); all code steps show complete code.

**3. Type consistency:** `SurfaceKey`/`Suggestion` defined in Task 1, imported unchanged by Tasks 2/3/4. `generateSuggestion(prompt: string): Promise<Suggestion>` produced in Task 2, consumed in Task 3 (`suggestion` field) and surfaced through the action to the client in Task 4. `suggestForSurface(surface, tripSlug?)` returns `{ suggestion?, error? }`, consumed as `res.suggestion`/`res.error` in Task 4. Query names/return fields (`getBudgetItems`->`amountCents`/`category`/`subject`, `getPackingItems`->`label`, `getItineraryLocations`->`name`, `getTripNotes`->`body`, `getItineraryDays`->`dayDate`/`title`/`events[].time`/`.text`, `listChecklists`->`name`/`done`/`total`, `TripListItem`->`name`/`country`/`startDate`/`endDate`) match the interfaces read from source. `getTripBySlug(workspaceId, slug)` arg order matches source.
