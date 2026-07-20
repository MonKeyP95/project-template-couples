# Trip Journal — Design (Slice 1)

Date: 2026-07-20
Status: Design approved; Slice 1 ready for an implementation plan.

## What this is

A per-trip **journal** — a raw, location-organized record of *what the couple
actually did and spent* on a trip, assembled from data the app already holds
(itinerary + expenses + ratings). It is the "raw data first" foundation of a
four-layer pipeline that eventually replaces today's per-trip summary and feeds
the couple profile.

Origin: `docs/IDEAS.md` "The trip journal that writes itself". This design
supersedes the framing there — the journal is **not** a warm during-trip diary
for the couple to enjoy. Its purpose is a durable post-trip record that (a) feeds
the couple profile and (b) is a self-contained, shareable/matchable unit
(the north-star: a database of trip summaries matched across couples, with the
full journal shared post-match under permission — a future privacy/AI layer).

## The pipeline (target architecture)

```
RAW DATA          ->  JOURNAL            ->  TRIP SUMMARY         ->  COUPLE PROFILE
(already stored)      (per trip, derived,    (per trip, one AI        (past summaries,
itinerary / expenses  location-organized      pass at trip close,      compressed +
/ ratings             raw record)             the matchable unit)      current trip raw)
```

Principles that fell out of the brainstorm and shape every slice:

- **No profile learning during a trip.** The raw journal builds continuously
  (free — it is just aggregation), but the AI *summary* is generated **once, when
  a trip closes** (dates-driven: today past the trip's end date). This retires
  the continuous `isSummaryStale` / "N new ratings — refresh" churn that exists
  today; staleness collapses into one event: "a trip finished -> summarize it."
- **Dates-driven close, lazy generation.** A trip is "current/raw" while today
  is within its dates; once past, it is eligible for a summary, generated lazily
  on the next profile view. No cron, no button. A dateless dream never closes and
  is never summarized (correct — a dream is not a record of what happened).
- **Couple profile = past-trip summaries (compressed) + current trip raw (full
  fidelity).** Only *old* trips fade to summaries; the trip you are on / just
  finished stays raw, where detail matters most. This is what the assistant reads
  as the cross-trip couple profile. It resolves the fidelity-vs-scale tradeoff:
  we do not throw away detail on the live trip.

## Slices

- **Slice 1 (this spec, designed in full): the raw journal.** Derived assembler +
  additive render on `/profile`. No AI, no schema change, deletes nothing.
- **Slice 2 (sketched): the trip summary.** One AI pass from the journal at
  dates-driven close; the matchable/shareable unit; persisted + hand-editable
  (like `trip_summaries` today). *Replaces* the per-trip taste blocks and the
  per-trip budget widget — only once built and verified.
- **Slice 3 (sketched, deferred): profile reads from summaries.** Rewire the
  top-level couple categories + budget history to "past summaries + current raw".
  Highest risk (touches working code that feeds live AI suggestions), lowest
  reversibility; do it when trip count makes the direct read expensive or when
  matching is being built.

## Slice 1 — the raw journal (full design)

### Derived, not stored

The journal is a **pure assembler over existing data** — no new table, no
migration, nothing to keep in sync. The record is always exactly what is in the
source tables. (Only the Slice-2 summary gets persisted, because it is an
editable AI artifact. When the full journal is eventually shared post-match, it
is serialized from the derived record at that moment — still no need to store it.)

### Record structure (location backbone)

The itinerary is already `location -> day -> event`, and expenses carry both
`dayDate` and `locationId` (see `expense-types.ts`), so **location is the key
that unifies "what we did" and "what we spent."**

- **Trip header** — name, destination, dates, day count, member count.
- **Per location** (itinerary order, with its date span):
  - *What happened* — the itinerary events there. Each event: text, inferred
    category (food/activity/…), and its rating + free-text note when present
    (the note is gold for the record and for matching).
  - *What it cost* — expenses attributed to that location: title, amount,
    category. Example: "surf school 80" sits under Ericeira, beside the
    "surf lesson" event.
- **Pre-trip (before you go)** — a dedicated section at the top, sourced from the
  before-you-go checklist: `trip_budget_items` where `category = "Pre-trip"`
  (insurance, flights, gear). Each item: title + amount, plus a subtotal. This is
  where "did they get insurance?" surfaces. These amounts **are** counted as spent
  for the trip (see Money totals) — a trip's true cost includes what was paid
  before leaving.
- **Unplaced spend** — actual expenses with neither `locationId` nor a placeable
  `dayDate` that are not pre-trip. Title, amount, category.
- **Money totals** — **total spent = actual expenses + pre-trip amounts**
  (a trip's true cost includes pre-trip bookings). Per-category totals include a
  "Pre-trip" line. **Settle-up (who owes whom) is computed from actual `expenses`
  only** (`summarizeBudget`) **— for now, because pre-trip items carry no payer
  yet** (a current data limitation, not a permanent choice; see Future/deferred).
  So total trip cost is a separate, larger figure than the settle-up pool.
  **Planned-vs-
  actual variance is deliberately not here** — that fact belongs to the Slice-2
  summary. (Pre-trip is the one intentional exception to "journal = actuals only":
  it is sourced from a planned-items table but treated as committed spend, because
  there is no actual-expense equivalent and the content is real trip cost.)

### Placement rules

- **Date-inferred placement.** An expense with a `dayDate` but no `locationId`
  is slotted into the location whose date span contains that day. Only expenses
  with neither fall to Unplaced spend. Cheap, and location spans are
  authoritative.
- **Settlements excluded** from journal content and per-category totals (they are
  cash transfers between members, not "what happened"); they still feed settle-up.

### "Enough happened" floor

Empty/buffer itinerary days are skipped (nothing happened there). The journal
renders for a trip only when it has real content — some events or some spend.
Dreams and empty trips show nothing. This mirrors today's "nothing here yet"
gating.

### Surface: additive, on `/profile`

A per-trip **Journal** block is added to the existing "By trip" section of
`/profile` (`src/app/profile/page.tsx`), rendered per started trip alongside —
not replacing — today's per-category taste blocks and the `TripBudget` widget.
`/profile` will briefly show both; that transitional clutter is accepted so the
foundation slice touches nothing at risk.

### Modules (proposed)

- `src/lib/journal/journal-types.ts` — pure types + helpers (`JournalRecord`,
  `JournalLocation`, `JournalEvent`, `JournalExpense`, totals; the
  date-in-span placement helper and the "enough happened" predicate). No
  server-only imports, so the client render can share types
  (the `*-types.ts` split rule).
- `src/lib/journal/journal-queries.ts` — server: fetch trip locations, itinerary
  days, expenses, ratings, and pre-trip items (`trip_budget_items` where
  `category = "Pre-trip"`) for a trip, then call the assembler. Uses
  `parseEvents` from `itinerary-types` and `summarizeBudget` from
  `expense-types`.
- `src/app/profile/trip-journal.tsx` — presentational render of a
  `JournalRecord`, wired additively into the `byTripRows` loop in `page.tsx`.

### Out of scope for Slice 1 (explicit)

- No AI (that is Slice 2). No new table / migration. No deletion of any existing
  code or UI. No planned-vs-actual variance. No sharing/export/matching. No live
  on-the-road surface (the journal is a profile record, not a during-trip view).

### Future / deferred

- **Pre-trip "paid by whom" -> joins settle-up.** Pre-trip items
  (`trip_budget_items`, category "Pre-trip") carry no payer today, so pre-trip
  spend counts toward total trip cost but not toward settle-up. Adding a payer
  (a `paid_by` column on Pre-trip budget items, or migrating pre-trip into
  `expenses`) would let pre-trip spend join the who-owes-whom balance. **Design
  guard for Slice 1:** keep settle-up a single computed spot in the assembler so
  folding pre-trip payers in later is a localized change, not a rewrite.

## Deletion / cleanup policy

**Slice 1 deletes nothing.** Working code is removed only *after* the thing that
supersedes it is built, tested, and verified in the app:

- The per-trip **taste blocks** and the per-trip **budget widget** are retired in
  Slice 2, once the summary demonstrably replaces them.
- The **direct-read profile path** (profile reading raw signals across all trips)
  is retired in Slice 3, once summary-of-summaries is verified.

## Gap analysis — nothing from today's trip-summary surface is lost

| Today on `/profile` | Lands in | Guard |
| --- | --- | --- |
| Per-trip taste blocks (food/activity/accom/transport, editable, AI-refresh, staleness) | Slice 2 trip summary | keep editable; churn machinery intentionally retired |
| Per-trip budget widget (actual vs **planned**, variance) | Slice 1 shows actual per location + totals; **variance** moves to Slice 2 summary | do not lose "we run +X% over on food" |
| Budget history (cross-trip /day avg, variance %) | Slice 3 profile rollup, from summaries | preserve /day + variance % |
| Top-level couple categories + dining-preference forms | Stays; rewired in Slice 3 | dining forms are manual prefs — untouched |
| "Nothing here yet" floors | Journal "enough happened" floor | |

## Success criteria (Slice 1)

- A pure `journal-types` assembler turns a trip's locations + itinerary days +
  expenses + ratings into a `JournalRecord`, unit-testable with no DB or AI.
- On `/profile`, each started trip with real content shows a Journal block:
  a pre-trip section, locations with their events (ratings/notes) and their
  spend, unplaced spend, and money totals.
- Total spent includes pre-trip amounts; settle-up is computed from actual
  expenses only.
- Date-inferred placement works; settlements excluded from content/totals.
- Dreams and empty trips show no journal.
- Nothing existing on `/profile` is removed or changed.
- `pnpm lint` and `pnpm build` pass.
