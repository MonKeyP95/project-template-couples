# Budget planner — real Claude draft (design)

Date: 2026-07-09
Status: approved, ready for plan

## What this is

The guided budget assistant (the "Plan a budget" / "Edit budget" drafter on the
Budget tab) is the last mock AI surface alongside the suggestion cards. Today its
line items come from `src/lib/ai/budget-planner.ts` — a pure, deterministic mock
that seeds flat multipliers (EUR 110/night lodging, 150/person transport,
25/person/day food) and estimates any blank cost at a flat EUR 50.

This slice makes it **real**, the same mock-to-real move already done for chat
(slice 7) and discovery: the concrete suggested line items and their amounts come
from Claude, reading the trip's destination, itinerary, and profile, so the draft
reflects the actual place and trip style instead of one flat table.

Confirmed intent (2026-07-09): "make it real (Claude)", not a smarter mock.

## Principle: deterministic scaffold, AI content

The interview **structure** stays deterministic — it is UI, not intelligence:

- The five category steps (Accommodation, Transport, Food & drink, Activities,
  Anything else), their questions/hints/`addNoun`.
- The location grouping (Accommodation and Activities grouped one sub-group per
  itinerary place; Transport/Food/Other flat trip-wide).

Only the **content** becomes AI: the concrete suggested line items (subject, when
label, amount) that seed each bucket. Claude knows that a riad night in Chefchaouen
costs less than a Reykjavík hotel and that a Sahara tour is a real activity line;
the mock cannot.

This keeps the change surgical, preserves the working location-grouping invariant,
and shrinks the model's failure surface to "fill these buckets".

## Architecture

Three pieces, mirroring `sendChatMessage` -> `chatReply`:

### 1. New `claude.ts` seam — `draftBudgetSeeds(context)`

- Plain `anthropic.messages.create` + one structured tool `propose_budget`
  (same structured-extraction-via-tool-use pattern as `propose_places`).
- **No `web_search`.** A budget draft is an *estimate*; Claude's parametric cost
  knowledge is good enough and answers in ~one round-trip. Web search tripled
  discovery latency for no gain here (see the 2026-07-07 latency decision). Live
  web-grounded prices are deferred.
- Input `context`:
  - `destination` — country (falls back to trip name).
  - `locations` — `{ name, nights, dateLabel }[]` in order (season and length
    matter for lodging/activity pricing).
  - `tripDays`, `memberCount`.
  - `vibe` (trip profile vibe tags) + `brief` (trip profile free brief) — the
    highest-signal input for budget *level* (backpacking vs honeymoon).
  - `budgetBand` — the couple's dining budget band from `dining_preferences`.
- Returns a flat list of `DraftedBudgetItem`:
  `{ category, place, subject, whenLabel, amountEuros }`.
  - `category` is one of the five category labels
    (Accommodation/Transportation/Food/Activities/Other).
  - `place` is a location **name** (or empty for trip-wide). Echoing names, not
    ids — the action matches names back to ids; unmatched -> trip-wide.
  - `amountEuros` is a whole-euro integer; never an exact quoted price.
- Suggest-only: returns data, never writes. Server-only (in `claude.ts`).

### 2. New server action — `draftBudget(input)`

New `"use server"` file (e.g. `src/lib/ai/budget-actions.ts`).

- Signature: `draftBudget(input: BudgetPlanInput & { tripSlug: string })`
  -> `{ steps: BudgetStep[]; drafted: boolean }`.
  - `BudgetPlanInput` (tripName, totalDays, memberCount, locations with
    id/name/nights/dateLabel) is what the client already computes in `open()`, so
    no night/date derivation is duplicated server-side.
- Steps:
  1. `scaffold = planBudgetSteps(input)` — the deterministic structure + mock
     seeds as the fallback baseline.
  2. Load AI-only context server-side: `getCurrentWorkspace()` ->
     `getTripBySlug(workspace.id, tripSlug)` (gives `country` and `tripProfile`
     vibe/brief) and `getDiningPreferences(workspace.id)` (budget band).
  3. `items = await draftBudgetSeeds(context)`.
  4. **Merge**: replace each bucket's seed with Claude's items for that bucket.
     Bucket = category -> step key; `place` matched to a location by
     case-insensitive name (unmatched or empty -> trip-wide / flat step). A
     grouped step's group with no Claude items keeps its (possibly empty) mock
     seed. Return `{ steps, drafted: true }`.
  5. On any failure (missing key, network, model error, no items): return
     `{ steps: scaffold, drafted: false }` — the interview always opens with the
     deterministic seeds. This is real product need (model calls fail; a wizard
     that won't open is broken), not speculative defensiveness.

### 3. Client — `budget-drafter.tsx`

- `open(fromScratch)` becomes **async**:
  - **Edit budget** (saved items exist, not `fromScratch`): unchanged — loads
    saved rows via `serverToSaved(initialItems)`, **no AI call**.
  - **Plan a budget** (no saved items) and **Start over** (`fromScratch`): set a
    loading state, `await draftBudget({ ...input, tripSlug })`, seed the session
    from the returned `steps`.
- New loading state on the launcher button ("drafting…", disabled) so the async
  gap is visible. New session flag surfaces the quiet note when `drafted === false`:
  a single muted line, "couldn't reach the assistant — using rough estimates".
- `estimateItemCents` stays deterministic (blank user-added rows on step-advance).
  `budget-planner.ts` stays a plain module: `planBudgetSteps` now consumed
  server-side in the action, `estimateItemCents` still imported client-side.

## Data flow

```
Budget tab (AI on)
  -> BudgetDrafter.open()  [client builds locInput as today]
     -> draftBudget({ tripName, totalDays, memberCount, locations, tripSlug })  [server action]
        -> planBudgetSteps(input)                 [deterministic scaffold]
        -> getTripBySlug / getDiningPreferences   [AI-only context]
        -> draftBudgetSeeds(context)              [claude.ts, structured tool, no web_search]
        -> merge items into scaffold buckets
     <- { steps, drafted }
  -> render interview (real seeds, or mock seeds + quiet note on drafted:false)
  -> user edits -> Apply -> saveBudgetItems      [the only write, unchanged]
```

## Invariants held

- **One AI seam.** All model calls stay in `lib/ai/claude.ts`.
- **Suggest-only.** `draftBudgetSeeds` returns data; the sole write is the
  existing `saveBudgetItems` behind the user's Apply. Nothing under `lib/ai` writes.
- **AI-gated.** The drafter still renders only with AI mode on (unchanged). The
  always-available manual path is the `PlannedBudget` scope editors below it.
- **No migration, no new deps, no new vendor.**

## Out of scope (deferred)

- Real per-item estimate (`estimateItemCents` stays deterministic) — avoids
  mid-interview network calls.
- Web-grounded live prices (kept parametric for latency).
- Reading logged expenses / itinerary event text to refine the draft.
- Making the suggestion cards real (separate surface).
- Per-partner or currency-aware budgets.
