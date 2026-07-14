# Budget learning — Slice 3: the budget suggestion harness (v1: raise-the-buffer)

**Date:** 2026-07-14
**Status:** design, ready to plan
**Part of:** the budget-learning arc ([[project-budget-learning-vision]]). Follows Slice 1
(per-trip lens), Slice 2 (cross-trip history on /profile), Slice 2.5 (per-trip summary on
/profile). This is the third and final slice: the numbers start to **advise**.

## Why

Slices 1-2.5 built the durable numeric artifact: a per-`(trip, category)` row of
`{planned, actual}`, readable per-trip and across trips. So far it only *displays*. Slice 3
makes it **speak up** — the couple's own budget history flags something worth acting on —
while holding the arc's invariant: **numbers are the artifact; AI reasons over them but
never rewrites them.**

This plugs into the existing proactive-nudge framework (`src/lib/nudges/`, the
`weather-packing` / `near-daily-cap` detectors) rather than forking a new mechanism. A
budget flag is just another deterministic detector; the novel capability it unlocks is
**cross-trip reasoning** — "this category ran over on your last trips" — which no existing
detector covers.

## Scope decision: raise-the-buffer first

The full vision names three flags (raise-the-buffer, over-on-a-category, cheaper-than-usual).
**v1 ships only `raise-the-buffer`** — the genuinely new cross-trip capability — plus the
reusable **seed-the-chat harness** the other two will reuse. The two on-the-road flags are
explicit fast-follows (see Non-goals), building on the same detector shape and seed path.

## Core constraint (inherited): token control

From the nudge framework — proactive must never mean "the assistant spends tokens on its
own." Two separable things:

1. **Noticing** — a deterministic pure function over data the page already has (or a cheap
   batched read). Zero tokens, no Claude.
2. **Wording / acting** — costs tokens, and happens **only on an explicit tap**.

Slice 3 does #1 for free. The deterministic flag line is fully computed from the numbers.
#2 happens only when the couple taps `help`, which opens the existing chat prefilled with a
numbers-laden draft — and even then **nothing is sent to Claude until they press send**.

## The detector — `raise-the-buffer` (planning, Budget tab)

New pure file `src/lib/nudges/raise-the-buffer.ts`, same `Nudge | null` shape as the
existing detectors:

```ts
detectRaiseTheBuffer(ctx: {
  // This trip's per-category planned amounts (cents), keyed by category name.
  thisTripPlan: Record<string, number>
  // Past started trips' per-category rollups (reused slice-2 TripRollupInput[]),
  // excluding this trip.
  pastRollups: TripRollupInput[]
}): Nudge | null
```

**Fires when**, for the single worst category:
- the category ran **over plan** (actual > planned) on **>= 2** past started trips, and
- those overruns are material (average overrun `>= RAISE_MIN_OVERRUN_CENTS`), and
- this trip **under-budgets it again**: `thisTripPlan[cat] < averagePastActual[cat]`
  (i.e. the couple is about to repeat the shortfall).

Only categories with a plan on **this** trip are considered (advice must be actionable on a
line they are actually setting). If several qualify, pick the one with the largest average
overrun. Returns `null` when none qualify (no past trips, no chronic overrun, or this trip
already budgets generously).

**Deterministic line:**
`"{Category} ran over on {n} of your last {m} trips (avg +€{avgOverrun}). Consider a bigger {Category} buffer."`

**Restraint:** at most **one** budget flag on the surface — the single worst category. Never
a list.

Thresholds (`RAISE_MIN_OVERRUN_CENTS`, the `>= 2` trip count) are named constants, tunable.

## Data source (reused)

- `thisTripPlan`: the current trip's planned amounts by category — already available on the
  trip page from `budgetItems` (summed per category).
- `pastRollups`: the workspace's **other started trips'** rollups. Reuses the slice-2
  `getTripRollups(trips)` (`src/lib/trips/budget-history-queries.ts`) over a workspace-scoped
  started-trips list, filtered to exclude the current trip. `averagePastActual` and the
  overrun counts are derived from each rollup's `perCategoryRollup` output.

No new table, no new rollup logic. This is a third **reader** of the existing budget
artifact (per "reuse existing systems, don't build parallel ones"). The `TripRollupInput` /
`perCategoryRollup` types are the single source of truth, unchanged.

## The `help` path — prefilled chat, no new AI seam

The couple taps `help` on the flag → the existing chat (`AskLine` in `assistant-block.tsx`)
opens **prefilled** with a deterministic draft question carrying the flag's exact numbers:

> "Activities ran over on 2 of our last 3 trips (avg +€110) and we've budgeted €150 this
> time. How much should we set aside?"

Mechanism:

- `NudgeHelp` (`src/lib/nudges/types.ts`) gains an optional **`seed: string`** — the drafted
  question. `detectRaiseTheBuffer` fills it from the same numbers as the flag line.
- `AskLine` gains an optional way to **prefill its input** (a `seed` prop / initial input
  value, consumed once so the user can still edit or clear it).
- `AssistantBlock` already owns both the `nudge` slot and the `AskLine`. On `help`, it
  expands (`setEnabled(true)` is already the AI-on state — here the block is already open
  since planning nudges render only when expanded) and sets the `AskLine` seed to
  `nudge.help.seed`.

Why seed the **visible input** rather than hidden context: it is transparent (the couple
sees exactly what will be asked and can edit it), it keeps the token contract obvious
(nothing fires until send), and the numbers reach Claude **inside the user message** — so
the chat's permanent context is unchanged and there is no path by which the model rewrites a
stored amount. `claude.ts` / `sendChatMessage` signatures are untouched.

## Surfacing / plumbing (planning only in v1)

`raise-the-buffer` is a **planning** flag — it advises on a plan being set, so it rides the
existing planning on/off contract: it renders **inside the expanded (AI-on) assistant
block**, nothing while collapsed.

- The `/trips/[slug]` **server page** fetches the workspace's other started trips, builds
  `pastRollups` via `getTripRollups`, computes `detectRaiseTheBuffer`, and passes the
  resulting `Nudge | null` down through `BudgetTab` into the existing
  `<AssistantBlock ... nudge={...} />` slot (`budget-tab.tsx:178`, currently no `nudge`
  prop).
- `AssistantBlock` renders it through the existing `<NudgeLine>` path (already wired at
  `assistant-block.tsx:65`). `NudgeLine` already renders a `help` button whenever both
  `nudge.help` and an `onHelp` callback are present (`nudge-line.tsx:17`) — today the
  planning path passes no `onHelp`, so no button shows. v1 passes an `onHelp` that seeds
  `AskLine`; `NudgeLine` itself is unchanged.

Files touched:
- New: `src/lib/nudges/raise-the-buffer.ts`.
- `src/lib/nudges/types.ts` — add `seed?: string` to `NudgeHelp`.
- `src/components/assistant-block.tsx` — pass an `onHelp` for the nudge that seeds `AskLine`;
  give `AskLine` an initial-input (seed) prop consumed once.
- `src/app/trips/[slug]/page.tsx` (server) — fetch other started trips, compute the nudge,
  pass it down.
- `src/app/trips/[slug]/budget-tab.tsx` — thread the `nudge` prop into `AssistantBlock`.

No new server action, no `lib/ai` seam change, no migration.

## Two modes

`raise-the-buffer` is planning-mode by nature (it advises a plan). On the road, budget
advice is the job of the two fast-follow detectors (`over-on-a-category`,
`cheaper-than-usual`), deferred below. No mode branch is needed in v1: the flag simply
renders in the Budget tab's assistant block whenever it fires.

## Invariants

- **Numbers are the artifact.** The detector reads planned/actual; it never writes them. The
  AI path is advisory chat only — no apply-to-plan.
- **Token control.** Detection is deterministic (zero Claude calls on render); the flag line
  is deterministic; Claude fires only on an explicit chat *send* after `help` prefills the
  input.
- **Suggest-only.** Nothing under `src/lib/nudges/` or the touched UI mutates data.
- **One nudge seam.** `claude.ts`, `generateSuggestion`, `sendChatMessage` unchanged.
- **Reuse.** Third reader of the slice-1/2 rollup artifact; no parallel budget store.

## Non-goals

- **Fast-follow: `over-on-a-category`** (on the road) — per-category whole-trip overspend
  with days left; renders through the on-the-road `RoadNudge` free-line pattern; help seeds
  the road chat. Same detector + seed shape as v1.
- **Fast-follow: `cheaper-than-usual`** (on the road) — this trip's per-category run-rate
  below the cross-trip €/day baseline ("you've got room"). On the road only: "running so
  far" has no meaning before the trip.
- **Apply-to-plan** — AI writing a suggested planned amount back into the Budget tab crosses
  the "numbers are the artifact" line; needs explicit confirm; a later slice.
- **A dedicated budget-advice `lib/ai` seam** (a one-shot `budgetAdvice()` card) — parked;
  chat carries the reasoning for now.
- **Multiple stacked budget flags per surface; snooze/dismiss persistence; multi-currency;
  per-location caps.**

## Testing / verification

No test runner in this repo.

- Unit-test the pure detector (throwaway tsx, delete after): with fabricated `pastRollups` +
  `thisTripPlan`, assert it fires on a chronically-over, under-budgeted category, picks the
  worst one, and returns `null` when there are `< 2` overruns / no past trips / this trip
  already budgets `>= averagePastActual`.
- `pnpm lint` + `pnpm build` clean.
- In-app (logged-in): on a workspace with **>= 2 finished trips** that overran a category
  (e.g. Activities), plan a new trip that under-budgets that category → open the Budget tab
  assistant block → the raise-the-buffer flag shows with correct `n`/`m`/avg → tap `help` →
  the chat input is prefilled with the numbers → editing/sending reaches Claude, whose reply
  reasons over the numbers and does not alter any stored amount. A workspace with no chronic
  overrun (or generous plan) shows no flag.

## Risks

- **Cross-trip read from a trip surface** is new plumbing (the trip page has not needed other
  trips' budgets before). Mitigated: it reuses `getTripRollups` wholesale; only a
  workspace-scoped started-trips fetch + current-trip exclusion is new.
- **Category-name coupling** (free-text category names across trips) is unchanged from Slices
  1-2 — "Activities" must match by name to aggregate. Acceptable; same limitation the whole
  arc carries.
- **Seed-into-chat** touches the working `AskLine`. Mitigated: the seed is an optional
  initial input value, consumed once; the default (no seed) path is byte-identical to today.
