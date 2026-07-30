# Budget pace tracker — above or below, on the move

Status: designed 2026-07-30, not yet built.

## The problem

Nothing in the app tells you where you stand against your budget *part-way
through a trip*. The Budget tab shows `spent / planned` — a number that only
resolves at the end. `detectNearDailyCap` covers today alone, against a flat
`plannedBudget / tripDays` cap. Between them there is no answer to the question
you actually ask on day six: **are we above or below?**

## Two things it must not do

**1. It must not judge a period the couple hasn't logged yet.** Expenses are
entered in batches — a food stall, a trek, a course, all typed in on Thursday.
Worse, `on-the-road/quick-expense.tsx` hardcodes `dayDate: today` with no date
field, so Thursday-entered Monday dinner is *stored* as Thursday. Per-day
amounts on the fast logging path are already fiction.

Zero-spend and not-logged-yet are identical in the data and mean opposite
things. A naive tracker reads three unlogged days as €300 under budget and
congratulates you for laziness.

**2. It must not cry wolf on front-loaded costs.** A trip that pre-pays flights
reads catastrophically over on day 1 under a flat cap, and stays "over" for a
week while spending perfectly normally. A tracker that is wrong on day 1 is
ignored by day 3.

## Shape

Three decisions, taken in this order:

| Decision | Answer |
|---|---|
| Above or below *what*? | The planned burn curve from `trip_budget_items`; flat `plannedBudget / days` when the walk wasn't done |
| Daily, weekly or monthly? | Derived from trip length, not configured — same as how "on the road" mode is dates-driven |
| Where does it live? | Compact line on `/on-the-road`, full strip on the Budget tab |

Cumulative, not per-day bars, is the truth line. Batching destroys per-day
amounts but leaves *totals* correct the moment you log: dump Thursday's three
days of receipts and the cumulative gap snaps right whatever dates they landed
on. A per-day bar for Monday never recovers — it reads €0 forever.

## The pure core

`src/lib/trips/budget-pace.ts`. No migration, no new deps, no AI call.

Inputs, all already loaded on both pages: the trip's `startDate`, `endDate`,
`plannedBudgetCents`; `today`; `expenses`; `budgetItems`; and a `locationDays`
map (location id → its sorted dates) built from `getItineraryDays`.

### Planned curve

Each budget item resolves to a day span, then lands on it:

| Span comes from | `freq` | Lands as |
|---|---|---|
| `whenStart`/`whenEnd` when present | `times` | spread evenly across those days |
| else `locationId` → that location's days | `daily` | spread evenly per day |
| else the whole trip | `once` | **all of it on the first day of the span** |

`amount_cents` is already the resolved total (per the 2026-07-16 "How often"
work — `unit price × quantity` is stored multiplied out), so spreading is
division, never re-multiplication.

With no budget items, the curve is flat: `plannedBudget / tripDays` per day.
Same UI either way; the line gets sharper the more the couple planned. This
graceful fallback is deliberate — the 2026-07-14 raise-the-buffer nudge was
built and reverted because it required per-category plans that real trips did
not have. A tracker that only works for well-planned trips would repeat that.

### The watermark

`lastLogged` = the latest `dayDate` among non-settlement expenses inside the
trip window, capped at `today`.

**The delta is measured at the watermark, not at today.** Comparing
spend-through-Tuesday against plan-through-Thursday manufactures a €240
*underspend* out of nothing but not having typed yet. So the headline compares
`planned(through lastLogged)` against `spent(through lastLogged)`, and the
"as of TUE" stamp is load-bearing rather than decorative.

### Buckets

Trip-relative, never calendar-aligned (day 1–7 is week 1):

| Trip length | Bucket |
|---|---|
| ≤ 9 days | day |
| 10–42 days | week |
| > 42 days | month |

Each bucket carries `plannedCents`, `spentCents`, `status: past | current |
future`, and `logged` — false for any bucket entirely past the watermark, which
renders as a dashed empty track, never as a €0 bar.

### Exclusions

Dropped from **both** sides so the two stay comparable: settlements
(`isSettlement`), the reserved `"Pre-trip"` category, and expenses whose
`dayDate` is null or falls outside the trip window.

Because both sides drop pre-trip together, the Budget tab states its
denominator outright — *"€1,400 budget − €420 before you go = €980 on the
road"* — so the assumption is visible instead of silently baked in.

### Accepted limit

Log Thursday's coffee but forget Monday through Wednesday, and those three days
read as a genuine €0. The watermark cannot distinguish "spent nothing" from
"skipped". The unlogged nudge covers the common case; nothing short of asking
covers this one, and asking is not worth it.

## The four pieces

**A. Compact line on `/on-the-road`** — directly above `QuickExpense`, in the
slot `RoadNudge` already occupies, so the verdict sits next to the act of
logging.

```
€170 over  ·  week 1  ·  as of TUE
█████████▒▒
```

Over renders `clay`, under renders `moss`, matching existing tone usage. No
drill-down here.

**B. Full strip on the Budget tab** — under `SpentFigure`, above per-category.
Renders only while the trip is running (`today` within `start..end`), so a
finished or unstarted trip's Budget tab is unchanged. Buckets are rows; tapping
one expands a single level (week → its days, month → its weeks).

```
€170 over · day 6 of 14 · as of TUE
WEEK 1  ███████▒▒  €170 over  ›
 WED ████  THU ██  FRI ░░░
WEEK 2  ░░░░░░░░░  to come
```

**C. Date chip on `QuickExpense`** — a `[TODAY ▾]` control beside the category
select: *today / yesterday / pick a day*, the picker clamped to the trip
window. It sets the `dayDate` that `logExpense` already accepts, so **no server
action changes**. This is the highest-value part of the slice: it does more for
the tracker's accuracy than anything inside the tracker. The `€X today` figure
in that card keeps meaning today.

**D. `detectUnloggedDays`** — new pure detector in `src/lib/nudges/`, fires at
≥ 2 days past the watermark, rendered through the existing `NudgeLine` /
`RoadNudge`. Deterministic, zero tokens; its help tap scrolls to the expense
form.

## Deliberate non-changes

- **`detectNearDailyCap` stays.** It answers "is *today* running hot"; the
  tracker answers "is the *trip* running hot". Different questions. If the two
  read as clutter together in-app, retiring the cap nudge is a one-line delete
  — not worth churning shipped work on a guess.
- **No tracker without a budget.** `plannedBudgetCents === 0` renders nothing,
  the same rule as the `BudgetBars` shipped 2026-07-30. Dreams have no dates,
  so no tracker.
- **No currency work.** Planning amounts (`trip_budget_items`, location
  budgets) are already in the trip's home currency and `perCategoryRollup` is
  already fed `homeCents(e)`. Both sides of the pace sum the same way.

## Files

New:
- `src/lib/trips/budget-pace.ts` — the pure core
- `src/lib/nudges/unlogged-days.ts` — the pure detector
- `src/components/budget-pace-strip.tsx` — compact and full variants

Edited:
- `src/app/on-the-road/page.tsx` — wire the compact line + nudge
- `src/app/on-the-road/quick-expense.tsx` — date chip
- `src/app/trips/[slug]/budget-tab.tsx` — wire the full strip
- `src/app/trips/[slug]/page.tsx` — pass `locationDays`

No migration. No new dependency. No `lib/ai` change.

## Success criteria

### Verified by Claude

1. `pnpm lint` and `pnpm build` clean (build only when the dev server is not
   holding `.next`).
2. `budgetPace` checked by a throwaway tsx script — the approach the slice-3
   detector used, since there is still no test framework:
   - flat fallback: €1,400 over 14 days, no items → planned through day 6 =
     **€600**
   - items: `once` flight €420 (whole trip) + `daily` food €840 → planned
     through day 1 = **€480**, through day 6 = **€780**
   - buckets: 5 days → 5 daily buckets; 14 days → 2 weekly; 60 days → monthly
   - watermark: expenses on d1–d2 with today = d6 → delta measured through
     **d2**; every bucket after d2 carries `logged: false`
   - exclusions: a settlement, a `"Pre-trip"` item, a null-`dayDate` expense,
     and an expense dated before `startDate` each change no figure
3. `detectUnloggedDays` returns `null` at 0–1 unlogged days and a `Nudge` at ≥ 2.
4. `budgetPace` returns nothing renderable when `plannedBudgetCents === 0` or
   `today` falls outside the trip window.
5. `QuickExpense` passes the chosen date through to `logExpense`, whose
   signature is unchanged.

### Verified by the user in-app

1. Running trip with a budget: the over/under line sits above the expense form
   on `/on-the-road`, and its figure matches the Budget tab's.
2. The Budget tab strip shows the right bucket size for that trip's length, and
   tapping a week opens its days.
3. Logging an expense with the chip set to **yesterday** lands it on yesterday
   in the ledger, and moves *yesterday's* bar, not today's.
4. Two days without logging: the "unlogged" line appears, days past the
   watermark render hatched rather than as €0, and the headline reads
   "as of ⟨day⟩".
5. At a 440px viewport the strip is readable with no horizontal scroll.
6. No budget set, a dream, or a finished trip shows no tracker anywhere.
7. On a trip whose spend currency differs from its home currency, the figures
   render in the home currency and tie out to the Budget tab.
