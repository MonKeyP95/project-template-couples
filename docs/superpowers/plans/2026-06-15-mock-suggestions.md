# Mock AI Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a canned, dismissible mock suggestion card on the Budget view, trip page (all tabs), Notes, Home, On the road, and Checklists — behind a seam that becomes a real model later.

**Architecture:** A pure seam (`lib/ai/suggestions.ts`) returns a canned `Suggestion` per surface. A client wrapper (`ai-suggestion.tsx`) renders the existing `SuggestionCard` with a working dismiss (session hide) and inert apply. `SuggestionCard` gains optional `onApply`/`onDismiss` callbacks (backward-compatible). Placements drop `<AiSuggestion surface=…/>` into each surface.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript. Existing `SuggestionCard` in `@/components/together`.

**Testing note:** No test framework in this repo and `CLAUDE.md` says not to invent one. The gate for every task is `pnpm lint` + `pnpm build` passing, plus the manual check in the final task.

---

### Task 1: The suggestions seam (pure mock)

**Files:**
- Create: `src/lib/ai/suggestions.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Mock for AI suggestions. Pure, no network. The seam where a real model lands
 * later: keep SurfaceKey/Suggestion stable, then make suggestionFor async and
 * generate from the LLM client. `context` is reserved for trip facts; the mock
 * ignores it. Content here is a deterministic placeholder, easy to swap.
 */

export type SurfaceKey =
  | "budget"
  | "trip"
  | "notes"
  | "home"
  | "road"
  | "checklists"

export interface Suggestion {
  label: string
  body: string
}

const SUGGESTIONS: Record<SurfaceKey, Suggestion> = {
  budget: {
    label: "/ suggested",
    body: "Street food keeps daily costs low in much of Southeast Asia — you could trim the food estimate and pad activities.",
  },
  trip: {
    label: "/ assistant",
    body: "Popular treks and permits sell out in peak season — worth booking the big-ticket items early.",
  },
  notes: {
    label: "/ suggested",
    body: "Jot your guesthouse check-in time and any booking references here so they're handy once you're on the road.",
  },
  home: {
    label: "/ assistant",
    body: "Your next trip is coming up — a good moment to start the packing list together.",
  },
  road: {
    label: "/ assistant",
    body: "Log expenses as you spend today so the settle-up stays honest and there's nothing to reconstruct later.",
  },
  checklists: {
    label: "/ suggested",
    body: "Duplicate a past list as a starting point instead of building a new one from scratch.",
  },
}

export function suggestionFor(
  surface: SurfaceKey,
  context?: string,
): Suggestion | null {
  void context
  return SUGGESTIONS[surface] ?? null
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: no errors for `src/lib/ai/suggestions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/suggestions.ts
git commit -m "feat(ai): pure mock suggestions seam (suggestionFor)"
```

---

### Task 2: SuggestionCard gains optional action callbacks

**Files:**
- Modify: `src/components/together/suggestion-card.tsx`

Add optional `onApply` / `onDismiss`. When provided, the matching button calls the handler. Existing call sites pass none, so Packing/Itinerary stay inert.

- [ ] **Step 1: Extend the props interface**

Replace the `SuggestionCardProps` interface with:

```ts
export interface SuggestionCardProps {
  label: string
  children: React.ReactNode
  expandable?: boolean
  applyLabel?: string
  dismissLabel?: string
  onApply?: () => void
  onDismiss?: () => void
  className?: string
}
```

- [ ] **Step 2: Destructure and wire the handlers**

Replace the component signature and the actions block. The new signature:

```tsx
export function SuggestionCard({
  label,
  children,
  expandable = false,
  applyLabel,
  dismissLabel,
  onApply,
  onDismiss,
  className,
}: SuggestionCardProps) {
```

And the actions block (the `hasActions` JSX) becomes:

```tsx
      {hasActions ? (
        <div className="mt-3 flex gap-1.5">
          {applyLabel ? (
            <button
              type="button"
              onClick={onApply}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              {applyLabel}
            </button>
          ) : null}
          {dismissLabel ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              {dismissLabel}
            </button>
          ) : null}
        </div>
      ) : null}
```

- [ ] **Step 3: Verify it lints**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/together/suggestion-card.tsx
git commit -m "feat(together): optional onApply/onDismiss on SuggestionCard"
```

---

### Task 3: The AiSuggestion wrapper

**Files:**
- Create: `src/components/ai-suggestion.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import * as React from "react"

import { SuggestionCard } from "@/components/together"
import { suggestionFor, type SurfaceKey } from "@/lib/ai/suggestions"

export function AiSuggestion({
  surface,
  className,
}: {
  surface: SurfaceKey
  className?: string
}) {
  const suggestion = React.useMemo(() => suggestionFor(surface), [surface])
  const [dismissed, setDismissed] = React.useState(false)

  if (!suggestion || dismissed) return null

  return (
    <SuggestionCard
      label={suggestion.label}
      dismissLabel="dismiss"
      onDismiss={() => setDismissed(true)}
      className={className}
    >
      {suggestion.body}
    </SuggestionCard>
  )
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: no errors. (Not rendered anywhere yet.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-suggestion.tsx
git commit -m "feat(ai): AiSuggestion wrapper (dismiss hides; apply inert)"
```

---

### Task 4: Place AiSuggestion on every surface

Each step adds an import and one `<AiSuggestion>`. Verify lint+build once at the end.

- [ ] **Step 1: Budget view** (`src/app/trips/[slug]/budget-tab.tsx`)

Add the import next to the other local component imports (near `import { BudgetDrafter } from "./budget-drafter"`):

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

In the `view === "budget"` block, insert immediately before `<BudgetDrafter`:

```tsx
          <div className="px-5 pt-4">
            <AiSuggestion surface="budget" />
          </div>
```

- [ ] **Step 2: Trip page, all tabs** (`src/app/trips/[slug]/page.tsx`)

Add the import with the other component imports:

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

Immediately after `<DesktopTabs slug={header.slug} active={activeTab} />`, insert:

```tsx
        <div className="px-5 pt-4 lg:px-10">
          <AiSuggestion surface="trip" />
        </div>
```

- [ ] **Step 3: Notes tab** (`src/app/trips/[slug]/notes-tab.tsx`)

Add the import:

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

As the first element inside the `NotesTab` component's returned top-level wrapper (before the add-note form), insert:

```tsx
      <div className="px-5 pt-4">
        <AiSuggestion surface="notes" />
      </div>
```

(If the wrapper already has horizontal padding, drop the `px-5` and keep `pt-4`. Match the surrounding padding so the card aligns with the notes content.)

- [ ] **Step 4: Home** (`src/app/home/page.tsx`)

Add the import:

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

Immediately before the `<Link href="/trips/new"` CTA, insert:

```tsx
      <AiSuggestion surface="home" className="mt-9 block" />
```

- [ ] **Step 5: On the road** (`src/app/on-the-road/page.tsx`)

Add the import:

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

Immediately after `<Label className="mb-4 block">{`On the road · ${trip.name}`}</Label>`, insert:

```tsx
        <AiSuggestion surface="road" className="mb-4 block" />
```

- [ ] **Step 6: Checklists** (`src/app/checklists/page.tsx`)

Add the import:

```tsx
import { AiSuggestion } from "@/components/ai-suggestion"
```

Between `<Label className="mb-4 block">Checklists</Label>` and `<ChecklistsOverview …/>`, insert:

```tsx
        <AiSuggestion surface="checklists" className="mb-4 block" />
```

- [ ] **Step 7: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (If `pnpm build` hits a Turbopack `0xc0000142` subprocess panic on Windows — a known flake, not a code bug — stop, delete `.next/`, and rerun.)

- [ ] **Step 8: Commit**

```bash
git add "src/app/trips/[slug]/budget-tab.tsx" "src/app/trips/[slug]/page.tsx" "src/app/trips/[slug]/notes-tab.tsx" src/app/home/page.tsx src/app/on-the-road/page.tsx src/app/checklists/page.tsx
git commit -m "feat(ai): show mock suggestion card on budget, trip, notes, home, road, checklists"
```

---

### Task 5: Manual verification + docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Manual check**

Run `pnpm dev`. Confirm a moss-bordered suggestion card appears on: the Budget view, the trip page on every tab (trip-level, below the tabs), the Notes tab, Home, On the road, and Checklists. Clicking **dismiss** hides that card; reloading brings it back. The existing Packing and Itinerary cards are unchanged.

- [ ] **Step 2: Update TODO.md**

Add a line near the top of `docs/TODO.md` recording the mock suggestions: seam `lib/ai/suggestions.ts` (`suggestionFor(surface)`), `AiSuggestion` wrapper (dismiss hides, apply inert), `SuggestionCard` gained optional `onApply`/`onDismiss`, placed on budget/trip/notes/home/road/checklists. Note deferred: real model, working apply, persisted/shared dismissal, trip-aware context; existing packing/itinerary cards left as-is.

- [ ] **Step 3: Add a DECISIONS.md row**

Append a row to `docs/DECISIONS.md`: mock suggestions built behind `suggestionFor`, rendered via the shared `SuggestionCard` (now with optional callbacks); dismissal is session-only; real model is a one-function swap.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record mock AI suggestions"
```

---

## Self-Review

- **Spec coverage:** seam (Task 1), SuggestionCard callbacks (Task 2), AiSuggestion wrapper with session-dismiss + inert apply (Task 3), all six placements incl. the trip-level reinterpretation (Task 4), manual check + docs + deferrals (Task 5). Error path: `suggestionFor` returns `Suggestion | null`, wrapper renders nothing on null (Task 3) — matches spec.
- **Type consistency:** `SurfaceKey`/`Suggestion`/`suggestionFor` from Task 1 are imported unchanged in Task 3; `AiSuggestion`'s `surface: SurfaceKey` matches the literal `surface="…"` values used in Task 4 (all are SurfaceKey members). `onDismiss` added in Task 2 is the prop passed in Task 3.
- **No placeholders:** every code step is complete. `void context` keeps the reserved param from tripping `no-unused-vars`. Notes-tab anchor (Step 3) gives a precise insertion rule since that file's exact wrapper is resolved at edit time.
