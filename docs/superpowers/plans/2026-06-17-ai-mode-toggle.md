# AI mode on/off toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-person AI on/off switch (off by default) that hides every AI surface when off, keeps budgeting working via a manual fallback, and records a suggest-only invariant.

**Architecture:** A `tz`/theme-style cookie (`ai`) read server-side, seeding a client context provider mounted in the root layout. Surfaces (`AiSuggestion`, `TripChat`, the budget assistant) self-gate via `useAiMode()`. The toggle lives on /profile and flips context + cookie. When off, the budget tab swaps the AI drafter for a plain manual budget field.

**Tech Stack:** Next.js 16 (async Server Components, `next/headers` `cookies()`), React 19 context, existing `updateTripBudget` server action. No schema, no dependencies.

**Note on verification:** This repo has no test framework (per CLAUDE.md). Each task is verified with `pnpm lint` + `pnpm build` and, in the final task, a manual in-app check — matching the established workflow.

**Spec:** `docs/superpowers/specs/2026-06-16-ai-mode-toggle-design.md`

---

### Task 1: Server `isAiEnabled()` helper + invariant

**Files:**
- Create: `src/lib/ai/ai-mode.ts`

- [ ] **Step 1: Write the helper**

```ts
// Suggest-only invariant: code under lib/ai returns data only. It must never
// import server actions or mutate state. Every write happens from an explicit
// user gesture (apply/confirm clicks, the manual budget field). This keeps the
// assistant suggest-only when a real model lands behind this seam.

import { cookies } from "next/headers"

export const AI_COOKIE = "ai"

/** AI mode is off unless the cookie is explicitly "on". */
export async function isAiEnabled(): Promise<boolean> {
  return (await cookies()).get(AI_COOKIE)?.value === "on"
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/ai-mode.ts
git commit -m "feat(ai): server isAiEnabled() cookie helper + suggest-only invariant"
```

---

### Task 2: Client provider, hook, and toggle

**Files:**
- Create: `src/components/ai-mode.tsx`

- [ ] **Step 1: Write the provider + toggle**

```tsx
"use client"

import * as React from "react"

// Inlined so this client bundle doesn't import the next/headers server module
// (see memory: client/server split rule). Must match AI_COOKIE in lib/ai/ai-mode.ts.
const AI_COOKIE = "ai"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

interface AiModeValue {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

const AiModeContext = React.createContext<AiModeValue>({
  enabled: false,
  setEnabled: () => {},
})

export function AiModeProvider({
  initialEnabled,
  children,
}: {
  initialEnabled: boolean
  children: React.ReactNode
}) {
  const [enabled, setEnabled] = React.useState(initialEnabled)
  return (
    <AiModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AiModeContext.Provider>
  )
}

export function useAiMode(): AiModeValue {
  return React.useContext(AiModeContext)
}

/** Per-person AI on/off switch. Off by default; writes the `ai` cookie. */
export function AiToggle() {
  const { enabled, setEnabled } = useAiMode()

  function toggle() {
    const next = !enabled
    setEnabled(next)
    document.cookie = `${AI_COOKIE}=${next ? "on" : "off"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="AI assistant"
      onClick={toggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-sea" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-mode.tsx
git commit -m "feat(ai): AiModeProvider, useAiMode, AiToggle"
```

---

### Task 3: Seed the provider in the root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { TimezoneCookie } ...` line, add:

```tsx
import { AiModeProvider } from "@/components/ai-mode"
import { isAiEnabled } from "@/lib/ai/ai-mode"
```

- [ ] **Step 2: Read the cookie + wrap children**

In `RootLayout`, after `const dark = await isDarkTheme()` add:

```tsx
  const aiEnabled = await isAiEnabled()
```

Then wrap the `{children}` expression in the provider:

```tsx
        <TimezoneCookie />
        <WorldMapBg className="fixed inset-0 -z-10 text-foreground/[0.07]" />
        <AiModeProvider initialEnabled={aiEnabled}>{children}</AiModeProvider>
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(ai): seed AiModeProvider from cookie in root layout"
```

---

### Task 4: Gate the suggestion cards

One edit covers all seven suggestion surfaces.

**Files:**
- Modify: `src/components/ai-suggestion.tsx`

- [ ] **Step 1: Add the gate**

Add the import after the existing imports:

```tsx
import { useAiMode } from "@/components/ai-mode"
```

In `AiSuggestion`, add the hook as the first line of the body and fold
`enabled` into the existing guard:

```tsx
  const { enabled } = useAiMode()
  const suggestion = React.useMemo(() => suggestionFor(surface), [surface])
  const [dismissed, setDismissed] = React.useState(false)

  if (!enabled || !suggestion || dismissed) return null
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-suggestion.tsx
git commit -m "feat(ai): hide suggestion cards when AI mode is off"
```

---

### Task 5: Gate the trip chat

**Files:**
- Modify: `src/app/trips/[slug]/trip-chat.tsx`

- [ ] **Step 1: Add the gate after all hooks**

Add the import after the existing imports:

```tsx
import { useAiMode } from "@/components/ai-mode"
```

In `TripChat`, add the hook with the other hooks (just after `void tripSlug`):

```tsx
  const { enabled } = useAiMode()
```

Then add an early return after the `React.useEffect(...)` block (so it sits
after every hook call, before `function send`):

```tsx
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending, open])

  if (!enabled) return null
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS (no rules-of-hooks warning — the return is after all hooks).

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/trip-chat.tsx"
git commit -m "feat(ai): hide trip chat when AI mode is off"
```

---

### Task 6: Manual budget-total field (AI-off fallback)

**Files:**
- Create: `src/app/trips/[slug]/budget-total-field.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import * as React from "react"

import { updateTripBudget } from "@/lib/trips/actions"

/** Plain manual budget editor shown when AI mode is off, so a budget can be
 * set without the AI drafter. Writes via the same updateTripBudget action. */
export function BudgetTotalField({
  tripId,
  tripSlug,
  plannedBudgetCents,
}: {
  tripId: string
  tripSlug: string
  plannedBudgetCents: number
}) {
  const [value, setValue] = React.useState(
    plannedBudgetCents > 0 ? (plannedBudgetCents / 100).toFixed(0) : "",
  )
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function save() {
    const n = Number(value)
    const cents = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : -1
    if (cents < 0) {
      setError("Enter a valid amount.")
      return
    }
    setError(null)
    startTransition(async () => {
      const r = await updateTripBudget({ tripId, tripSlug, plannedBudgetCents: cents })
      if (r.error) setError(r.error)
    })
  }

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="flex items-center justify-between gap-3">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Budget total
        </label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">€</span>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 rounded-lg border border-clay bg-transparent px-3 py-1.5 text-right font-mono text-[12px] text-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            save
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-[11px] text-clay">{error}</p> : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/budget-total-field.tsx"
git commit -m "feat(ai): manual budget-total field for AI-off mode"
```

---

### Task 7: Budget tab — drafter when on, manual field when off

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { BudgetDrafter } from "./budget-drafter"` line, add:

```tsx
import { BudgetTotalField } from "./budget-total-field"
import { useAiMode } from "@/components/ai-mode"
```

- [ ] **Step 2: Read AI mode in the component body**

`BudgetTab` is a client component. Add this near the top of its body (next to
the existing state/hooks):

```tsx
  const { enabled: aiEnabled } = useAiMode()
```

- [ ] **Step 3: Conditionally render**

Replace the `<BudgetDrafter ... />` block (currently lines ~121-130):

```tsx
          <BudgetDrafter
            tripId={tripId}
            tripSlug={tripSlug}
            tripName={tripName}
            tripDays={tripDays}
            plannedBudgetCents={plannedBudgetCents}
            locations={locations}
            itineraryDays={itineraryDays}
            memberCount={Object.keys(members).length}
          />
```

with:

```tsx
          {aiEnabled ? (
            <BudgetDrafter
              tripId={tripId}
              tripSlug={tripSlug}
              tripName={tripName}
              tripDays={tripDays}
              plannedBudgetCents={plannedBudgetCents}
              locations={locations}
              itineraryDays={itineraryDays}
              memberCount={Object.keys(members).length}
            />
          ) : (
            <BudgetTotalField
              tripId={tripId}
              tripSlug={tripSlug}
              plannedBudgetCents={plannedBudgetCents}
            />
          )}
```

(The `<AiSuggestion surface="budget" />` directly below already self-gates from
Task 4, so it needs no change.)

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(ai): budget tab uses manual field when AI off, drafter when on"
```

---

### Task 8: Toggle on the profile page

**Files:**
- Modify: `src/app/profile/page.tsx`

- [ ] **Step 1: Add the import**

After `import { ThemeToggle } from "@/components/theme-toggle"` add:

```tsx
import { AiToggle } from "@/components/ai-mode"
```

- [ ] **Step 2: Add the AI row**

After the existing Appearance row block (the `<div className="mt-8 flex items-center justify-between border-t border-border pt-6">...</div>` containing `ThemeToggle`), add:

```tsx
        <div className="mt-4 flex items-center justify-between border-t border-border pt-6">
          <span className="text-sm text-muted-foreground">
            AI assistant (off by default)
          </span>
          <AiToggle />
        </div>
```

(`AiToggle` reads the provider context seeded in the root layout, so no prop
is needed.)

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(ai): AI assistant toggle on profile page"
```

---

### Task 9: Manual verification + docs

- [ ] **Step 1: Manual check**

Run `pnpm dev`, sign in. With no `ai` cookie (default):
- No suggestion cards on any tab; no floating "ask" button on a trip.
- Budget tab shows the "Budget total" manual field; setting a value and
  pressing save updates the planned budget.

Go to /profile, flip the **AI assistant** switch on:
- Return to a trip: suggestion cards appear, the ask button appears, and the
  budget tab now shows the full assistant/drafter (no reload needed).
- Reload: the state persists (cookie). Clearing the `ai` cookie returns to
  the off default.

- [ ] **Step 2: Add a DECISIONS row**

In `docs/DECISIONS.md`, add this row directly under the table header (line
after `|---|---|---|`):

```markdown
| **AI mode is a per-person cookie (`ai`), off by default; one global switch gates all AI surfaces; suggest-only** | The user wants AI off unless explicitly turned on, and constrained even when on. A cookie mirrors the theme/timezone prefs (no schema); a root-layout context provider gates suggestion cards, trip chat, and the budget assistant via `useAiMode()`. Off swaps the budget drafter for a manual total field so budgeting still works. The suggest-only invariant (code under `lib/ai` never writes) keeps a future real model from acting autonomously. | 2026-06-17 |
```

- [ ] **Step 3: Update `docs/TODO.md`**

Add a shipped entry near the top of `docs/TODO.md` (above the most recent
dated entry):

```markdown
**AI mode on/off toggle: shipped 2026-06-17.** A per-person switch on /profile (off by default) gates every AI surface — suggestion cards (all 7), the trip chat, and the budget assistant. Cookie-based (`ai`, like theme/timezone): server `isAiEnabled()` (`src/lib/ai/ai-mode.ts`) seeds an `AiModeProvider` (`src/components/ai-mode.tsx`) in the root layout; `AiSuggestion`, `TripChat`, and the budget tab self-gate via `useAiMode()`. When off, the budget tab shows a manual `BudgetTotalField` instead of the drafter so budgeting still works. Suggest-only invariant recorded: code under `lib/ai` never writes. No schema, no deps. Spec: `docs/superpowers/specs/2026-06-16-ai-mode-toggle-design.md`. Plan: `docs/superpowers/plans/2026-06-17-ai-mode-toggle.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record AI mode toggle (DECISIONS + TODO)"
```

---

## Self-Review

**Spec coverage:**
- Persistence (cookie, default off, `isAiEnabled`) → Task 1.
- Provider/hook/toggle → Task 2; seeded in root layout → Task 3.
- Gate suggestion cards → Task 4; trip chat → Task 5; budget tab → Task 7.
- Manual budget fallback → Task 6 (component) + Task 7 (wiring).
- Toggle on /profile → Task 8.
- Suggest-only invariant → Task 1 comment + Task 9 DECISIONS row.
- Verification + docs → Task 9.
All spec sections map to a task.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code.

**Type consistency:** `AI_COOKIE` matches between `lib/ai/ai-mode.ts` (Task 1) and the inlined client copy (Task 2). `useAiMode()` returns `{ enabled, setEnabled }` and is consumed consistently in Tasks 4, 5, 7, 8. `AiModeProvider` takes `initialEnabled` (Tasks 2, 3). `BudgetTotalField` props (`tripId`, `tripSlug`, `plannedBudgetCents`) match its definition (Task 6) and call site (Task 7). `updateTripBudget({ tripId, tripSlug, plannedBudgetCents })` matches the existing `UpdateTripBudgetInput`.
