# AI mode on/off toggle — design

**Date:** 2026-06-16
**Status:** Approved (pending spec review)

## Problem

The app has AI-flavored surfaces — suggestion cards on seven surfaces, the
trip chat, and the budget assistant/drafter — all currently mock. The user
wants AI **off by default**, turning on only by an explicit, per-person
action, and even when on the AI must stay constrained: it suggests, it does
not act.

## Decisions

- **Gates everything AI.** When off: suggestion cards, the trip chat, and
  the budget assistant all disappear.
- **Per-person, default off.** A cookie (like theme / timezone). Absent
  cookie = off, so off-by-default needs no special handling. Each partner
  has their own switch; no shared/DB state.
- **Suggest-only when on.** AI surfaces suggestions and chat replies but
  **never performs a write or calls a server action**. Every data change
  remains a manual user action. Recorded as a `lib/ai` invariant so it holds
  when a real model is wired in.
- **Budget keeps working with AI off.** Since `updateTripBudget` is reachable
  only through `BudgetDrafter` today, AI-off swaps the drafter for a plain
  manual budget-total field. No loss of function.

## Architecture

Mirror the existing cookie-preference pattern (`src/lib/theme.ts` +
`ThemeToggle`). A single client context provider, seeded from the server
cookie, gates all surfaces — cleaner than threading a prop into ~9 render
sites, and it gives the toggle instant feedback with no first-paint flash.

### Components

**1. Server helper — `src/lib/ai/ai-mode.ts`**

```ts
import { cookies } from "next/headers"

export const AI_COOKIE = "ai"

/** AI mode is off unless the cookie is explicitly "on". */
export async function isAiEnabled(): Promise<boolean> {
  return (await cookies()).get(AI_COOKIE)?.value === "on"
}
```

**2. Client provider + toggle — `src/components/ai-mode.tsx`** (`"use client"`)

- `AiModeProvider({ initialEnabled, children })` holds `useState(initialEnabled)`
  and exposes `{ enabled, setEnabled }` via context.
- `useAiMode()` reads that context.
- `AiToggle()` is a `ThemeToggle`-styled `role="switch"` that flips
  `setEnabled` for instant UI feedback and writes the `ai` cookie
  (`on`/`off`, `path=/`, 1-year max-age, SameSite=Lax) for persistence.
  `AI_COOKIE` is inlined here (client bundle must not import the
  `next/headers` server module — per the client/server split rule).

**3. Root layout — `src/app/layout.tsx`**

Read the cookie server-side and wrap children so every surface is inside the
provider (all AI surfaces are nested under the root layout):

```tsx
const aiEnabled = await isAiEnabled()
// ...
<AiModeProvider initialEnabled={aiEnabled}>{children}</AiModeProvider>
```

**4. Gated surfaces** — each returns `null` (or its fallback) when off:

- `src/components/ai-suggestion.tsx` — `const { enabled } = useAiMode(); if (!enabled) return null` at the top. Covers all seven suggestion surfaces in one edit.
- `src/app/trips/[slug]/trip-chat.tsx` — same early `return null`, hiding the floating ask button + panel.
- `src/app/trips/[slug]/budget-tab.tsx` — render `BudgetDrafter` when `enabled`, else the manual field below.

**5. Manual budget fallback — `src/app/trips/[slug]/budget-total-field.tsx`** (`"use client"`)

A minimal control: shows the current planned total, lets the user type a new
amount and save via the existing `updateTripBudget`. No steps, no seeding, no
AI. Props mirror what `BudgetDrafter` needs from the budget tab
(`tripId`, `tripSlug`, `plannedBudgetCents`).

**6. Toggle placement — `src/app/profile/page.tsx`**

Add an "AI assistant" row beside the existing "Appearance" row:

```tsx
<div className="mt-4 flex items-center justify-between border-t border-border pt-6">
  <span className="text-sm text-muted-foreground">AI assistant (off by default)</span>
  <AiToggle />
</div>
```

`AiToggle` reads context (seeded by the provider), so it needs no prop.

## Data flow

1. Request → root layout reads `ai` cookie → `AiModeProvider` seeded.
2. Surfaces read `useAiMode().enabled`; off → hidden / manual fallback.
3. User flips `AiToggle` on /profile → context updates (instant) + cookie
   written (persists across reloads and navigations).
4. The partner's cookie is independent; their experience is unchanged.

## Suggest-only invariant

Documented at the top of `src/lib/ai/ai-mode.ts` and as a `docs/DECISIONS.md`
row: **code under `lib/ai` returns data only — it never imports server
actions, never mutates.** Writes happen exclusively from explicit user
gestures (existing apply/confirm clicks; the manual budget field). When the
real model lands behind the `lib/ai` seam, this rule keeps it suggest-only.

## Testing / verification

- `pnpm lint` + `pnpm build` clean.
- Logic: with no `ai` cookie, `isAiEnabled()` is false; with `ai=on`, true.
- Manual, AI off (default): no suggestion cards on any tab, no ask button,
  budget tab shows the manual total field and a budget can still be set.
- Manual, after flipping the toggle on /profile: cards + chat + drafter
  appear immediately (no reload); reload persists the state.
- Second account / cleared cookie confirms per-person independence.

## Deferred

- Shared/workspace-level AI setting (this is per-person by choice).
- Granular per-surface toggles (one global switch only).
- Any real model wiring — unchanged; this only gates visibility.
