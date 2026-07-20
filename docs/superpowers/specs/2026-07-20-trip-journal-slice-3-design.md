# Trip Journal — Slice 3 Design (declutter the closed-trip journal)

Date: 2026-07-20
Status: Design approved; ready for an implementation plan.
Parent: `docs/superpowers/specs/2026-07-20-trip-journal-design.md` (pipeline, Slice 1),
`docs/superpowers/specs/2026-07-20-trip-journal-slice-2-design.md` (trip summary at close).

## What this is

The **decluttering** the last two slices kept promising. On `/profile` "By trip",
once a closed trip has an AI taste summary, its redundant raw journal stops
rendering — the summary stands in for it. Ongoing trips and low-signal closed
trips keep their journal, so no trip row is ever blank.

## Scope decision (deliberately narrow)

The parent design's "Slice 3" sketched three things of very different risk:

- **(a) declutter the closed-trip journal** — low risk, reversible, delivers the
  overlap cleanup explicitly deferred in Slices 1 and 2.
- **(b) re-source the AI summary from the journal** — medium risk, modest value
  today (same inputs, cleaner seam).
- **(c) rewire the top-level general profile + budget history to "past summaries +
  current raw"** — high risk, low reversibility, feeds live AI suggestions; a
  scale optimization that is premature at the current data size (the direct raw
  read is both cheaper and higher-fidelity until there are many trips or matching
  is being built).

**This slice is (a) only.** (b) and (c) are held until matching or scale actually
pushes on them, per the parent design's own guard: do (c) "when trip count makes
the direct read expensive or when matching is being built" — neither is true yet.

## Nothing is deleted (the property that makes this safe)

The journal is **derived, not stored** (Slice 1: "Derived, not stored"). There is
no `journal` table — `getTripJournal` / `assembleJournal` is a pure assembler over
`itinerary_locations`, `itinerary_days`, `expenses`, `event_ratings`, and
`trip_budget_items`. Hiding the journal block removes **only a rendered view on
`/profile`**:

- The trip stays in the `past` bucket with all data intact.
- The `/trips/[slug]` workspace (itinerary, expenses, budget) is untouched.
- `getTripJournal` can re-derive the full journal at any time — it is one
  conditional away from rendering again, and it is still what gets serialized if
  the journal is ever shared/exported post-match.

## The single rule

In the `byTripRows` render loop (`src/app/profile/page.tsx`), render the journal
when **either**:

- the trip is **not** closed (an ongoing `now` trip — the journal is its only
  record), **or**
- the closed trip has **no** taste blocks (`blocks.length === 0` — the journal is
  its only qualitative record).

Equivalently: **hide the journal only when the trip is closed AND has taste
blocks.** "Closed" reuses the `pastTripIds` set already computed at
`page.tsx:76`; the row already carries `blocks` and `journal`.

## What changes

`src/app/profile/page.tsx` only — the `{journal ? <TripJournal .../> : null}`
line (~313) is gated by the rule above (e.g. a `showJournal` boolean per row, or
an inline condition). The `byTripRows` inclusion filter is **unchanged** (a trip
still appears if it has taste, budget, or a non-empty journal), so hiding the
journal render never removes a row that has a summary — those rows still show
their taste + money blocks.

## What does NOT change

- `getTripJournal` / `assembleJournal` / `journal-queries.ts` — untouched; the
  journal is still fetched for all started trips (ongoing and low-signal closed
  trips still render it).
- Top-level general "What we like" sections (`LearnedSummary` reading the
  cross-trip couple summary) — untouched (that is deferred part (c)).
- `BudgetHistory`, `TripBudget`, `LearnedSummary` component — untouched.
- No schema, no migration, no deps, no AI/prompt change.

## Row outcomes after this slice

| Trip state | Renders |
| --- | --- |
| Ongoing (`now`) | Journal only (unchanged) |
| Closed (`past`) **with** taste blocks | Taste blocks + money block; **journal hidden** |
| Closed (`past`) below signal floor (no taste blocks) | Journal kept (+ money block if it has spend); never blank |

## Accepted trade-offs

- A closed trip with taste blocks no longer shows per-location raw spend/events on
  `/profile`. That detail still lives in the trip workspace and is re-derivable;
  the summary (taste blocks + money block) is the intended compressed replacement.
- The money block (`TripBudget`) still renders for closed trips alongside the
  taste blocks — money is never AI'd, so it is not "raw journal clutter"; it is
  part of the summary per Slice 2.

## Success criteria

- On `/profile`, a **closed** trip **with** taste blocks shows its taste blocks +
  money block and **no** raw journal.
- A **closed** trip **below** the signal floor (no taste blocks) still shows its
  journal (and money block if it has spend) — its row is not blank.
- An **ongoing** trip still shows its raw journal.
- The inclusion of trips in "By trip" is unchanged; no row disappears.
- The top-level general sections and `BudgetHistory` are unchanged.
- No schema/migration; `getTripJournal` and the AI input are untouched.
- `pnpm lint` and `pnpm build` pass.
