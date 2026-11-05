# Budget card in the dispatch box

Date: 2026-11-05. Status: design approved in chat; awaiting plan.

## Intent

On the road, the couple wants one glance to answer "are we over or under our
budget, and by how much?", in the same place they already look for general
information: the dispatch box (the "feed") at the top of `/on-the-road`, which
rotates weather and the daily what's-on items.

They also want to choose **what "the budget" means for that check**: today's
share, this week's share, or the whole trip so far. The choice is the
couple's, shared by both partners, set once on the profile and editable.

## Why now

The 2026-08-03 dispatch-box design cut a budget card because `PaceLine`
already showed budget pace on the same page ("two readings of one number").
The user has now decided the number belongs in the feed. The resolution is
that the card **replaces** `PaceLine` on `/on-the-road`, so the number still
appears once. The previous slice (PR #83) made the trip's estimate the
couple's own total, which this card reads.

## Goals

1. A budget card in the dispatch box: one over/under sentence plus a bar, for
   the chosen period.
2. A shared, editable profile setting: **per day / per week / whole trip**.
3. `PaceLine` removed from `/on-the-road`.

## Non-goals

- No change to the budget tab's full `PaceStrip` (`budget-tab.tsx`).
- No change to the near-daily-cap nudge, the catch-up nudge, or the quick
  expense form's own figures.
- No per-trip override of the setting.
- No AI involvement. The card is pure numbers.

## Anti-goals

- Showing the over/under number twice on `/on-the-road`.
- A card that credits the couple with an underspend that is only unlogged
  spending (the watermark rule below exists to prevent this).
- A card on a trip with no estimate, or an empty/zero card. No estimate means
  no card.

## The setting

- New column `workspaces.budget_period text not null default 'trip'` with a
  check constraint `in ('day', 'week', 'trip')`. One migration in
  `supabase/migrations/`, re-runnable (add column if not exists; drop-then-add
  the constraint). Pasted by hand in the Supabase SQL editor.
- **RLS: only the workspace owner can update `workspaces`**
  (`workspaces_update_owner`, `20260525000001_phase_2_schema.sql`). A
  non-owner's update matches zero rows and returns no error, so
  `setWorkspaceCurrency` already silently does nothing for the partner today.
  **Decided (user, 2026-11-05): any member may update their workspace.** The
  same migration drops `workspaces_update_owner` and creates
  `workspaces_update_members` (`using` and `with check`
  `public.is_workspace_member(id)`), drop-if-exists first so it re-runs. This
  also fixes Home currency for the partner; the accepted cost is that a member
  can edit any workspace field (e.g. its name).
- UI on `/profile`, directly under the "Home currency" form, same pattern: its
  own `<form>` with a `<select>` and a save button, server action
  `setWorkspaceBudgetPeriod` in `src/lib/workspace/actions.ts` beside
  `setWorkspaceCurrency`. Label: "Budget check". Options: "Per day",
  "Per week", "Whole trip". Short helper line explaining it sets what the
  on-the-road budget card compares.
- The workspace query (`getCurrentWorkspace`) exposes it as `budgetPeriod`.
- *Claude's call:* default `'trip'`, so behaviour matches today until the
  couple chooses otherwise.
- "Set up when making the profile": there is no separate profile-creation
  flow, so this means the profile page, the same as Home currency.

## The card

Placement: inside `DispatchBox`, as a card **directly after weather** (before
dispatch items). It rotates with the others and adds a dot. It renders whether
or not the assistant is on. The box currently returns null when there is no
weather and no items; it must also render when only the budget card exists.

Styling: same chip shape as `WeatherCard` (rounded border, `bg-card`,
`px-3.5 py-2.5`). Not pressable: no expand, does not hold the rotation.

Content, by period:

| Period | Text (under / over) | Right side | Bar |
|---|---|---|---|
| day | "€35 left today" / "€20 over today" | none | today's spend / today's planned share |
| week | "€60 under this week" / "€60 over this week" | "as of 4 Nov" | week-to-watermark spend / planned |
| trip | "€120 under" / "€120 over" | "as of 4 Nov" | trip-to-watermark spend / planned (today's `PaceLine` figure) |

- Exactly on plan: "on budget" (any period).
- Tone: clay when over, muted when under or on budget.
- Bar: `Bar` from `@/components/together`, percentage capped at 100.
- Dates in "as of" use `dayLabel` (European order, already used by `PaceLine`).
- When nothing is logged in the period yet (week/trip): right side reads
  "nothing logged yet", same as `PaceLine`.
- Amounts in the trip's home currency via the existing `useCurrency` /
  `money` helpers.

## The numbers

All figures derive from the existing day-by-day spread in
`src/lib/trips/budget-pace.ts`: lines with dates or places land on those days,
others spread across the trip; pre-trip costs and the `Buffer` line are
excluded; settlements and pre-trip expenses are excluded from spend. No new
calculation of the plan itself.

- **day:** planned = today's planned share; spent = today's spend. **No
  watermark** (*Claude's call*): today is today, and if nothing is logged yet
  the card shows today's full share as left.
- **week:** trip-weeks, not calendar weeks (*Claude's call*): week 1 is trip
  days 1–7, week 2 days 8–14, and so on; the last week may be short. Planned and
  spent are summed from the current trip-week's first day through the
  watermark (last logged day), clipped to the week. If the watermark is before
  the week starts, the week counts as nothing logged yet.
- **trip:** exactly today's `PaceLine` figures (`plannedToDateCents`,
  `spentToDateCents`, `deltaCents`, `lastLogged`).
- Card only when `budgetPace(...)` returns non-null (dates set, estimate > 0,
  today within the trip).

Note: `budgetPace` does not currently expose its per-day maps, and its buckets
are sized by trip length (day/week/month), which does not match the chosen
period. How the period figures are produced (a new pure function in
`budget-pace.ts`, or `budgetPace` returning more) is left to the builder; it
must reuse the same spread so the trip figure and the budget tab agree.

## Removal

- Delete the `PaceLine` render on `src/app/on-the-road/page.tsx`. Remove the
  `PaceLine` export from `budget-pace-strip.tsx` if nothing else uses it.
- The page still computes `pace` (the catch-up nudge reads it).

## Docs to update when built

- `docs/DECISIONS.md`: a row superseding the 2026-08-03 "budget dropped from
  the box" cut, stating why (card replaces `PaceLine`; number shows once), and
  a row for workspace updates opening from owner to any member.
- `docs/TODO.md`: entry with the in-app checklist below.

## Left to the builder

- Function and component names, file split (keep modules short).
- How the period figures are computed from the existing spread (see note).
- Exact helper copy under the profile setting.

## Success criteria

Verified by Claude:
1. `pnpm lint` and `tsc --noEmit` clean; `pnpm build` passes (not while the dev
   server runs) or the Vercel preview build passes.
2. Migration re-runs without error (idempotent by construction: if-not-exists
   column, drop-then-add constraint and policies). After pasting,
   `select policyname from pg_policies where tablename = 'workspaces'` lists
   `workspaces_update_members` and not `workspaces_update_owner`.
3. Pure period function: for a 10-day trip, flat €1,000 on-the-road budget,
   today day 9, one €120 expense on day 8 and nothing on day 9:
   - day: planned 100, spent 0, delta -100;
   - week (week 2 = days 8–10, watermark day 8): planned 100, spent 120,
     delta +20;
   - trip: equals `budgetPace`'s `deltaCents` for the same input.
4. `setWorkspaceBudgetPeriod` rejects values outside day/week/trip.
5. `PaceLine` no longer rendered on `/on-the-road`.

Verified by the user in-app:
1. `/profile` shows "Budget check" under Home currency; saving "Per day" sticks
   after reload, and the partner sees the same value. The **partner** (not the
   owner) can also change it, and Home currency, and it sticks.
2. On the road with "Whole trip": the box has a budget card after weather with
   the same over/under `PaceLine` used to show; `PaceLine` is gone below.
3. With "Per day": the card reads "€X left today" before logging anything
   today; logging an expense lowers it; overspending turns it clay "€X over
   today".
4. With "Per week": the card reads over/under "this week" with "as of" the last
   logged day.
5. A trip with no estimate shows no budget card.
6. With the assistant off, the budget card still shows.
7. Phone viewport: card fits the box; dots include the budget card.
