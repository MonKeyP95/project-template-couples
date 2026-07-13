# Profile-aware Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-demand `/ suggest` engine read the couple's profiles (trip profile, couple taste, learned summaries) so its cards are specific, with a three-stop taste dial that controls how heavily the profile weighs.

**Architecture:** A new pure `buildProfileBlock(workspaceId, tripId?)` assembles a compact "who they are" string from existing queries. `suggestForSurface` appends that block plus a one-sentence dial directive to the prompt it already builds; `generateSuggestion` is unchanged. The dial is a cookie-persisted per-person setting (`surprise | balanced | feels-like-us`, default `balanced`) surfaced as a toggle in the `/ suggest` menu, mirroring the existing `ai` mode cookie.

**Tech Stack:** Next.js 16 App Router, TypeScript, Server Actions, `@supabase/ssr`. No new dependencies.

## Global Constraints

- **Suggest-only invariant:** code under `src/lib/ai` reads/returns data only, never writes or imports server actions (see the header comment in `src/lib/ai/ai-mode.ts`).
- **No new deps, no migration, no schema change.** The dial is a cookie; every data source already exists.
- **Client/server split rule:** a `"use client"` file must import shared types from a pure `*-types.ts` module, never from a module that imports `next/headers` (which breaks the client bundle). `taste-types.ts` is pure; `taste-level.ts` reads cookies.
- **No emojis** in code, copy, or commits.
- **No unit-test framework exists in this repo.** Per-task validation is `pnpm lint` + `pnpm exec tsc --noEmit`; a full `pnpm build` and in-app smoke run at the end. Do not invent a test runner.
- **Windows/Turbopack flake:** if `pnpm build` fails with a `0xc0000142` subprocess panic, stop, delete `.next/`, and retry — it is an environment flake, not a code error.
- **Default `TasteLevel` is `balanced`** for any missing/unrecognized cookie value.
- **`LearnedCategory` values are `"food"` and `"activity"`** (lowercase), per `src/lib/preferences/couple-summary-types.ts`.

---

### Task 1: Taste dial vocabulary + server read

Pure dial types/copy plus a server-side cookie reader. No behavior change yet — this is the shared foundation Tasks 3 and 4 consume.

**Files:**
- Create: `src/lib/ai/taste-types.ts`
- Create: `src/lib/ai/taste-level.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type TasteLevel = "surprise" | "balanced" | "feels-like-us"`
  - `const TASTE_COOKIE = "taste"`
  - `const TASTE_LEVELS: { value: TasteLevel; label: string }[]`
  - `function normalizeTaste(raw: string | undefined): TasteLevel`
  - `const TASTE_DIRECTIVE: Record<TasteLevel, string>`
  - `async function getTasteLevel(): Promise<TasteLevel>`

- [ ] **Step 1: Create the pure types module**

Create `src/lib/ai/taste-types.ts`:

```ts
// Pure types + copy for the taste dial. No server-only import so the client
// toggle and the server read can both share them (the *-types.ts split rule).

export type TasteLevel = "surprise" | "balanced" | "feels-like-us"

export const TASTE_COOKIE = "taste"

/** Dial stops in display order, with their toggle labels. */
export const TASTE_LEVELS: { value: TasteLevel; label: string }[] = [
  { value: "surprise", label: "surprise us" },
  { value: "balanced", label: "balanced" },
  { value: "feels-like-us", label: "feels like us" },
]

/** Falls back to "balanced" for anything unrecognized. */
export function normalizeTaste(raw: string | undefined): TasteLevel {
  return raw === "surprise" || raw === "feels-like-us" ? raw : "balanced"
}

/** One prompt sentence per stop; sets how heavily the profile prior weighs. */
export const TASTE_DIRECTIVE: Record<TasteLevel, string> = {
  surprise:
    "Lean away from their usual patterns; suggest something outside their comfort zone to help them discover.",
  balanced:
    "Let their taste gently color the suggestion; generalize it, don't echo it, and feel free to stretch.",
  "feels-like-us":
    "Lean into what they clearly love; suggest something that will feel unmistakably theirs.",
}
```

- [ ] **Step 2: Create the server cookie reader**

Create `src/lib/ai/taste-level.ts`:

```ts
import { cookies } from "next/headers"

import { normalizeTaste, TASTE_COOKIE, type TasteLevel } from "./taste-types"

/** The person's taste-dial setting; defaults to "balanced" when unset. */
export async function getTasteLevel(): Promise<TasteLevel> {
  return normalizeTaste((await cookies()).get(TASTE_COOKIE)?.value)
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors. (These files are not imported anywhere yet, so this only proves they compile.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/taste-types.ts src/lib/ai/taste-level.ts
git commit -m "feat(ai): taste-dial types + server cookie read"
```

---

### Task 2: Profile-context assembler

The `buildProfileBlock` helper that turns the four profile sources into one compact string. Pure read, omit-when-empty, `tripId` optional.

**Files:**
- Create: `src/lib/ai/profile-context.ts`

**Interfaces:**
- Consumes:
  - `getTripProfile(tripId: string): Promise<TripProfile>` from `@/lib/trips/queries` (`TripProfile = { idea: string; vibe: string[]; transport: string[] }`)
  - `getTripExpenseCategories(tripId: string): Promise<ExpenseCategoryRow[]>` from `@/lib/trips/expense-queries` (`ExpenseCategoryRow` has `name: string` and `details: string[]`)
  - `getDiningPreferences(workspaceId: string): Promise<DiningPreferences>` from `@/lib/preferences/dining-queries` (`{ budgetBand, vibeTags, dietary, cuisines, activities }`)
  - `getCoupleSummary(workspaceId, category): Promise<{ summaryMd: string; ratingCountAtGeneration: number }>` from `@/lib/preferences/couple-summary-queries`
- Produces: `async function buildProfileBlock(workspaceId: string, tripId?: string): Promise<string>` — a single-line string, or `""` when there is no profile data at all.

- [ ] **Step 1: Create the assembler**

Create `src/lib/ai/profile-context.ts`:

```ts
import { getCoupleSummary } from "@/lib/preferences/couple-summary-queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripExpenseCategories } from "@/lib/trips/expense-queries"
import { getTripProfile } from "@/lib/trips/queries"

/** A compact "who this couple is" block for suggestion prompts. Reads the trip
 * profile + trip category detail tags (trip-scoped) and the couple's dining taste
 * + learned summaries (workspace-scoped). Every piece is omitted when empty, so a
 * bare trip yields a short string and a profile-less workspace yields "".
 * Suggest-only: reads, never writes. */
export async function buildProfileBlock(
  workspaceId: string,
  tripId?: string,
): Promise<string> {
  const parts: string[] = []

  if (tripId) {
    const profile = await getTripProfile(tripId)
    if (profile.idea.trim()) parts.push(`Trip idea: ${profile.idea.trim()}.`)
    if (profile.vibe.length) parts.push(`Trip vibe: ${profile.vibe.join(", ")}.`)
    if (profile.transport.length)
      parts.push(`Getting around: ${profile.transport.join(", ")}.`)

    const cats = await getTripExpenseCategories(tripId)
    const detailed = cats
      .filter((c) => c.details.length)
      .map((c) => `${c.name} (${c.details.join(", ")})`)
    if (detailed.length) parts.push(`Category notes: ${detailed.join("; ")}.`)
  }

  const dining = await getDiningPreferences(workspaceId)
  if (dining.budgetBand !== "any")
    parts.push(`Dining budget: ${dining.budgetBand}.`)
  if (dining.cuisines.length)
    parts.push(`Cuisines they like: ${dining.cuisines.join(", ")}.`)
  if (dining.dietary.length) parts.push(`Dietary: ${dining.dietary.join(", ")}.`)
  if (dining.activities.length)
    parts.push(`Activities they love: ${dining.activities.join(", ")}.`)

  const food = await getCoupleSummary(workspaceId, "food")
  if (food.summaryMd.trim())
    parts.push(`Learned about their food taste: ${food.summaryMd.trim()}`)
  const activity = await getCoupleSummary(workspaceId, "activity")
  if (activity.summaryMd.trim())
    parts.push(`Learned about their activity taste: ${activity.summaryMd.trim()}`)

  return parts.join(" ")
}
```

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors. Confirms all four query imports resolve with the field names used above.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/profile-context.ts
git commit -m "feat(ai): profile-context assembler for suggestions"
```

---

### Task 3: Wire profile + dial into the suggestion prompt

`suggestForSurface` now resolves the trip id, appends the profile background section and the dial directive to the base prompt, and passes the enriched prompt to `generateSuggestion`. When there is no profile data, the prompt is byte-identical to today.

**Files:**
- Modify: `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Consumes: `buildProfileBlock` (Task 2), `getTasteLevel` + `TASTE_DIRECTIVE` (Task 1). `getTripBySlug` is already imported in this file.
- Produces: no new exported symbol; `suggestForSurface` keeps its signature and return shape.

- [ ] **Step 1: Add the imports**

In `src/lib/ai/suggestion-actions.ts`, the existing import block already includes `import { getTripBySlug } from "@/lib/trips/queries"`. Add these three lines alongside the other `@/lib/ai` imports (near the `generateSuggestion` / `isAiEnabled` imports at the top):

```ts
import { buildProfileBlock } from "@/lib/ai/profile-context"
import { getTasteLevel } from "@/lib/ai/taste-level"
import { TASTE_DIRECTIVE } from "@/lib/ai/taste-types"
```

- [ ] **Step 2: Add the `withProfile` helper**

Insert this helper directly above the `suggestForSurface` export (after the `buildScopedPrompt` function):

```ts
/** Appends the profile background + taste-dial directive when there is any profile
 * to lean on. With no profile the base prompt is returned unchanged (today's
 * behavior), and no dial directive is added. */
async function withProfile(
  base: string,
  workspaceId: string,
  tripId: string | undefined,
): Promise<string> {
  const block = await buildProfileBlock(workspaceId, tripId)
  if (!block) return base
  const taste = await getTasteLevel()
  return [
    base,
    `Who they are (background - a lens, not a checklist): ${block}`,
    TASTE_DIRECTIVE[taste],
  ].join(" ")
}
```

- [ ] **Step 3: Enrich the prompt inside `suggestForSurface`**

Replace the `try` block body of `suggestForSurface`. Current:

```ts
  try {
    const prompt = await buildScopedPrompt(surface, workspace.id, tripSlug, scope)
    if (!prompt) return { error: "No trip in context." }
    const suggestion = await generateSuggestion(prompt)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
```

New:

```ts
  try {
    const prompt = await buildScopedPrompt(surface, workspace.id, tripSlug, scope)
    if (!prompt) return { error: "No trip in context." }
    const tripId = tripSlug
      ? (await getTripBySlug(workspace.id, tripSlug))?.id
      : undefined
    const enriched = await withProfile(prompt, workspace.id, tripId)
    const suggestion = await generateSuggestion(enriched)
    return { suggestion }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
```

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/suggestion-actions.ts
git commit -m "feat(ai): suggestions read the profile + honor the taste dial"
```

---

### Task 4: Taste dial toggle in the /suggest menu

A three-button toggle at the top of the `/ suggest` scope menu that reads and writes the `taste` cookie. No `router.refresh()` is needed: the only consumer is the next `suggestForSurface` server action call, which reads the cookie fresh from the request.

**Files:**
- Modify: `src/components/assistant-block.tsx`

**Interfaces:**
- Consumes: `TASTE_LEVELS`, `TASTE_COOKIE`, `normalizeTaste`, `type TasteLevel` from `@/lib/ai/taste-types` (the pure module — respects the client/server split rule).
- Produces: no exported symbol; a local `TasteDial` component rendered inside `SuggestLine`'s menu stage.

- [ ] **Step 1: Add the import**

In `src/components/assistant-block.tsx`, alongside the existing `@/lib/ai/suggestion-types` import, add:

```ts
import {
  TASTE_LEVELS,
  TASTE_COOKIE,
  normalizeTaste,
  type TasteLevel,
} from "@/lib/ai/taste-types"
```

- [ ] **Step 2: Add the `TasteDial` component**

Add this near the other helper components in the file (e.g. just below the `Divider` function):

```tsx
function readTaste(): TasteLevel {
  if (typeof document === "undefined") return "balanced"
  const m = document.cookie.match(/(?:^|; )taste=([^;]+)/)
  return normalizeTaste(m?.[1])
}

/** Three-stop taste dial. Writes the `taste` cookie on pick; the next suggest
 * action reads it server-side, so no refresh is needed. */
function TasteDial() {
  const [level, setLevel] = React.useState<TasteLevel>(readTaste)
  function pick(v: TasteLevel) {
    setLevel(v)
    document.cookie = `${TASTE_COOKIE}=${v}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TASTE_LEVELS.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => pick(t.value)}
          className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] ${
            level === t.value
              ? "border-moss text-moss"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Render the dial at the top of the scope menu**

In `SuggestLine`, the final `return` (the scope menu, `stage === "menu"`) opens with:

```tsx
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <input
```

Insert the dial as the first child, above the free-text input row:

```tsx
  return (
    <div className="flex flex-col gap-3">
      <TasteDial />
      <div className="flex items-end gap-2">
        <input
```

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant-block.tsx
git commit -m "feat(ai): taste-dial toggle in the /suggest menu"
```

---

### Final validation (after all tasks)

- [ ] **Full build**

Run: `pnpm build`
Expected: build succeeds. If it panics with `0xc0000142`, delete `.next/` and retry (Windows/Turbopack flake, not a code error).

- [ ] **In-app smoke (needs a logged-in session + AI mode on)**

1. Open a trip with some profile data (an idea/vibe on the Profile tab, or category detail tags). Expand the `assistant` block; press `/ suggest`.
2. Confirm the three-stop dial shows (surprise us / balanced / feels like us), defaulting to `balanced`.
3. Run "this page" at `balanced`, then switch to `feels like us` and run again: the second suggestion should lean noticeably harder into the trip's stated taste.
4. Switch to `surprise us` and run: the suggestion should stretch away from the obvious.
5. Reload the page and reopen the menu: the dial remembers the last pick (cookie persisted).
6. On a bare trip with no profile at all, confirm `/ suggest` still returns a suggestion (falls back to today's behavior).

- [ ] **Update docs**

Add the shipped entry to `docs/TODO.md` and, if any non-obvious choice stands (e.g. dial as cookie with no refresh, three stops over five), a row to `docs/DECISIONS.md`.

---

## Self-Review

**Spec coverage:**
- Prior-not-filter framing -> Task 3 `withProfile` labels the block "background - a lens, not a checklist" and appends it last. ✓
- Three-stop dial, default balanced, cookie-persisted, in the suggest menu -> Tasks 1 + 4. ✓
- Profile block from all four sources, omit-when-empty, `tripId` optional -> Task 2. ✓
- Dial directive sentences (verbatim from spec) -> Task 1 `TASTE_DIRECTIVE`. ✓
- Empty-profile fallback omits both background section and dial line -> Task 3 `withProfile` early-returns `base`. ✓
- Two modes: no new mechanism, rides existing `modeLine` -> nothing added, base prompt unchanged upstream. ✓
- `generateSuggestion` unchanged -> Task 3 passes it the enriched string only. ✓
- No writes / no migration / no new deps -> confirmed across tasks. ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `TasteLevel`, `TASTE_COOKIE`, `TASTE_LEVELS`, `normalizeTaste`, `TASTE_DIRECTIVE`, `getTasteLevel`, `buildProfileBlock` names match across Tasks 1–4. `getCoupleSummary` uses lowercase `"food"`/`"activity"` per the real `LearnedCategory`. `getTripBySlug(...).id` typed `string | undefined`, matching `buildProfileBlock`'s optional `tripId`. ✓

---

## Revision (assistant-wide): Tasks 5–8

Tasks 1–4 shipped enrich-`/ suggest`-only with the dial inside the `/ suggest`
menu. This revision (see the updated spec's "Shared context, per-sub harness"
section) generalizes it: one shared context builder, consumed by each sub's own
harness, and the dial promoted to the assistant-block level. No engine merge, no
migration, no new deps.

### Task 5: Shared assistant context + refactor /suggest to consume it

Introduce the one "reads everything" builder and make the existing suggest harness
consume it instead of calling the pieces itself.

**Files:**
- Create: `src/lib/ai/assistant-context.ts`
- Modify: `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Consumes: `buildProfileBlock` (Task 2), `getTasteLevel` (Task 1), `TASTE_DIRECTIVE` + `TasteLevel` (Task 1).
- Produces: `interface AssistantContext { profileBlock: string; taste: TasteLevel; tasteDirective: string }` and `async function buildAssistantContext(workspaceId: string, tripId?: string): Promise<AssistantContext>`.

- [ ] **Step 1: Create the shared builder**

Create `src/lib/ai/assistant-context.ts`:

```ts
import { buildProfileBlock } from "./profile-context"
import { getTasteLevel } from "./taste-level"
import { TASTE_DIRECTIVE, type TasteLevel } from "./taste-types"

/** The shared "everything we know" context every assistant sub consumes: the
 * profile block plus the taste dial. Each sub's harness picks the fields it
 * needs. Suggest-only: reads, never writes. */
export interface AssistantContext {
  profileBlock: string
  taste: TasteLevel
  tasteDirective: string
}

export async function buildAssistantContext(
  workspaceId: string,
  tripId?: string,
): Promise<AssistantContext> {
  const profileBlock = await buildProfileBlock(workspaceId, tripId)
  const taste = await getTasteLevel()
  return { profileBlock, taste, tasteDirective: TASTE_DIRECTIVE[taste] }
}
```

- [ ] **Step 2: Point suggestion-actions at the shared builder**

In `src/lib/ai/suggestion-actions.ts`, replace the three imports added in Task 3:

```ts
import { buildProfileBlock } from "@/lib/ai/profile-context"
import { getTasteLevel } from "@/lib/ai/taste-level"
import { TASTE_DIRECTIVE } from "@/lib/ai/taste-types"
```

with the single shared-context import:

```ts
import { buildAssistantContext } from "@/lib/ai/assistant-context"
```

- [ ] **Step 3: Rewrite `withProfile` to consume the object**

Replace the current `withProfile` helper body:

```ts
async function withProfile(
  base: string,
  workspaceId: string,
  tripId: string | undefined,
): Promise<string> {
  const block = await buildProfileBlock(workspaceId, tripId)
  if (!block) return base
  const taste = await getTasteLevel()
  return [
    base,
    `Who they are (background - a lens, not a checklist): ${block}`,
    TASTE_DIRECTIVE[taste],
  ].join(" ")
}
```

with:

```ts
async function withProfile(
  base: string,
  workspaceId: string,
  tripId: string | undefined,
): Promise<string> {
  const { profileBlock, tasteDirective } = await buildAssistantContext(
    workspaceId,
    tripId,
  )
  if (!profileBlock) return base
  return [
    base,
    `Who they are (background - a lens, not a checklist): ${profileBlock}`,
    tasteDirective,
  ].join(" ")
}
```

The appended string is byte-identical to Task 3's output, so /suggest behavior is unchanged.

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit** — the controller commits; the implementer stops here.

### Task 6: Chat harness reads the shared context

Make "ask me anything" profile-aware and dial-honoring by folding the shared
context into the chat context string.

**Files:**
- Modify: `src/lib/ai/chat-actions.ts`

**Interfaces:**
- Consumes: `buildAssistantContext` (Task 5).
- Produces: no new exported symbol; `sendChatMessage` keeps its signature.

- [ ] **Step 1: Replace the file body**

Replace the whole of `src/lib/ai/chat-actions.ts` with (this folds the old
`tripContextFor` into a `chatContext` that also resolves the workspace for the
no-trip case, then appends the profile block + dial directive):

```ts
"use server"

import { chatReply } from "@/lib/ai/claude"
import type { ChatMessage } from "@/lib/ai/chat-types"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripBySlug } from "@/lib/trips/queries"

/** Server Action behind the assistant chat. Builds the shared assistant context
 * (trip facts when a slug is supplied, plus the profile block + taste dial) then
 * calls the real model. Any failure returns one honest inline message. */
export async function sendChatMessage(
  messages: ChatMessage[],
  tripSlug?: string,
): Promise<string> {
  try {
    const context = await chatContext(tripSlug)
    return await chatReply(messages, context)
  } catch {
    return "I couldn't reach the assistant just now — try again in a moment."
  }
}

async function chatContext(slug?: string): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return ""

  const lines: string[] = []
  let tripId: string | undefined
  if (slug) {
    const trip = await getTripBySlug(workspace.id, slug)
    if (trip) {
      tripId = trip.id
      lines.push(`The user is looking at their trip "${trip.name}".`)
      if (trip.country) lines.push(`Destination: ${trip.country}.`)
      if (trip.startDate && trip.endDate) {
        lines.push(`Dates: ${trip.startDate} to ${trip.endDate}.`)
      } else if (trip.fuzzyWhen) {
        lines.push(`When: ${trip.fuzzyWhen}.`)
      }
      const locations = await getItineraryLocations(trip.id)
      if (locations.length) {
        lines.push(
          `Itinerary places: ${locations.map((l) => l.name).join(", ")}.`,
        )
      }
      const mode = tripMode(trip.startDate, trip.endDate)
      if (mode) lines.push(mode)
    }
  }

  const { profileBlock, tasteDirective } = await buildAssistantContext(
    workspace.id,
    tripId,
  )
  if (profileBlock) {
    lines.push(
      `Who they are (background - a lens, not a checklist): ${profileBlock}`,
    )
    lines.push(tasteDirective)
  }
  return lines.join(" ")
}

/** Planning vs on-the-road, dates-driven (the app's mode rule). Coarse server
 * Date compare on ISO YYYY-MM-DD strings; a same-day timezone edge is
 * irrelevant to this hint. Null when the trip has no dates. */
function tripMode(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const today = new Date().toISOString().slice(0, 10)
  if (today >= startDate && today <= endDate) {
    return "They are on this trip right now — give present, in-the-moment help."
  }
  if (today < startDate) {
    return "This trip has not started yet — help them prepare and plan."
  }
  return "This trip is in the past — help them reflect or plan a future one."
}
```

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit** — the controller commits; the implementer stops here.

### Task 7: Discovery harness gets the dial

The door already reads the profile structurally, so it takes the dial ONLY — no
profile block (that would duplicate).

**Files:**
- Modify: `src/lib/ai/discovery-types.ts`
- Modify: `src/app/api/ai/discover/route.ts`
- Modify: `src/lib/ai/claude.ts` (the `discoveryPrompt` function only)

**Interfaces:**
- Consumes: `getTasteLevel` (Task 1), `TASTE_DIRECTIVE` + `TasteLevel` (Task 1).
- Produces: a new `taste: TasteLevel` field on `DiscoveryQuery`.

- [ ] **Step 1: Add `taste` to the query type**

In `src/lib/ai/discovery-types.ts`, add this import directly under the header comment block (before `export type DiscoveryCategory`):

```ts
import type { TasteLevel } from "./taste-types"
```

and add this field to the `DiscoveryQuery` interface, immediately after the `learned` field:

```ts
  /** How adventurous to be, from the assistant-wide taste dial. */
  taste: TasteLevel
```

- [ ] **Step 2: Populate `taste` in the route**

In `src/app/api/ai/discover/route.ts`, add the import alongside the other `@/lib/ai` imports:

```ts
import { getTasteLevel } from "@/lib/ai/taste-level"
```

Read it just before building the query (right after the `const summary = ...` line):

```ts
    const taste = await getTasteLevel()
```

and add `taste,` to the `query` object literal, right after `learned: summary.summaryMd,`:

```ts
      learned: summary.summaryMd,
      taste,
```

- [ ] **Step 3: Render the dial in `discoveryPrompt`**

In `src/lib/ai/claude.ts`, add `TASTE_DIRECTIVE` to the imports from `./taste-types`
(create the import line if none exists yet):

```ts
import { TASTE_DIRECTIVE } from "./taste-types"
```

In `discoveryPrompt(query)`, immediately after the `learnedLine` declaration, add:

```ts
  const dialLine = TASTE_DIRECTIVE[query.taste]
```

Then add `dialLine` to BOTH returned arrays, on the line immediately after
`learnedLine,`. The activity branch:

```ts
  if (query.category === "activity") {
    return [
      `Find things to do in ${query.destination}.`,
      ...moment,
      learnedLine,
      dialLine,
      "The couple generally —",
      list("Activities they enjoy", query.activities),
      list("Vibe", query.vibeTags),
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }
```

and the restaurant branch:

```ts
  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    ...moment,
    learnedLine,
    dialLine,
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
```

(`dialLine` is always a non-empty sentence, so `.filter(Boolean)` keeps it.)

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors. The typecheck proves every `DiscoveryQuery` construction now
supplies `taste`; the route is the only production caller. If a smoke/throwaway
caller elsewhere fails to compile, add `taste` there too.

- [ ] **Step 5: Commit** — the controller commits; the implementer stops here.

### Task 8: Move the dial toggle to the assistant-block level

The toggle leaves the `/ suggest` menu and renders once at the top of the expanded
assistant block, so it reads as the assistant's overall setting.

**Files:**
- Modify: `src/components/assistant-block.tsx`

**Interfaces:**
- Consumes: the existing `TasteDial` component (Task 4), unchanged.
- Produces: nothing new.

- [ ] **Step 1: Render `TasteDial` at the block level**

In `src/components/assistant-block.tsx`, the expanded region currently opens:

```tsx
      {enabled ? (
        <div className="flex flex-col">
          {nudge ? (
```

Insert the dial as the first child of that `flex flex-col` container, above the nudge:

```tsx
      {enabled ? (
        <div className="flex flex-col">
          <div className="px-4 py-3">
            <TasteDial />
          </div>
          {nudge ? (
```

(`TasteDial` is a function declaration later in the file, so it is hoisted and
usable here. No divider above it — it sits directly under the header button.)

- [ ] **Step 2: Remove `TasteDial` from the /suggest menu**

In `SuggestLine`'s final `return` (the scope menu), delete the `<TasteDial />` line
so it is not rendered twice:

```tsx
    <div className="flex flex-col gap-3">
      <TasteDial />
      <div className="flex items-end gap-2">
```

becomes:

```tsx
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit** — the controller commits; the implementer stops here.

### Revision final validation

- [ ] Full `pnpm build` clean.
- [ ] In-app smoke (logged in, AI on): the dial shows at the top of the expanded
  assistant block (not in the `/ suggest` menu); changing it visibly shifts a
  `/ suggest` result, a chat recommendation, and a find-a-place result; with a bare
  profile the three subs behave as before.
- [ ] Extend the TODO entry to note the assistant-wide generalization.

### Revision self-review

- Shared context (spec "Shared context, per-sub harness") → Task 5 `buildAssistantContext` returns the structured object; suggest refactored to consume it. ✓
- Chat harness reads profile + dial → Task 6. ✓
- Discovery harness gets dial only (no profile block) → Task 7 adds `taste` to the query + prompt, no profile block. ✓
- Dial promoted to block level, removed from suggest menu → Task 8. ✓
- No engine merge, no migration, no new deps → confirmed across tasks. ✓
- Type consistency: `AssistantContext` / `buildAssistantContext` (Task 5) consumed verbatim in Task 6; `taste: TasteLevel` field name consistent across `discovery-types`, the route, and `discoveryPrompt` (Task 7). ✓

