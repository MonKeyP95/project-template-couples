# Add an expense from an itinerary event

**Date:** 2026-07-13
**Status:** Approved, ready for planning

## Goal

Let a user tap a specific event inside an itinerary day and log an expense
against it. The expense is a **real** row in the `expenses` table — it flows
into the Budget tab and settle-up. The itinerary itself is unchanged: no event
schema change, nothing shown back on the event.

## Vision (user's words)

> Two events in a day. I want to press a specific event and add an expense; that
> expense goes to the budget. I do not need to see it on the itinerary day.

## Behavior

Each event row gets a small "add expense" affordance (a `€ +` button, revealed
on the event). Tapping it opens a compact inline form under that event:

- **Amount** — the one required input.
- **Category** — defaults to the first category; editable.
- **Paid-by** — defaults to the current user; editable (2-person pill toggle,
  same as `ExpenseFields` / `QuickExpense`).

On submit it creates one `expenses` row via the existing `logExpense` action.
The form closes; the itinerary re-renders unchanged. The row appears in the
Budget tab / settle-up.

### Inherited silently from the event/day (not shown as editable fields)

- `title` = the event's `text` (e.g. "Sushi dinner"). The event is where the
  user edits that name anyway, so we don't ask them to retype it. Fallback to
  the day `title` if `text` is empty.
- `dayDate` = the day's `dayDate`.
- `locationId` = the day's `locationId`.

## Reuse

- Calls the existing `logExpense` server action **unchanged**
  (`src/lib/trips/actions.ts`).
- Mirrors the compact `QuickExpense` layout (amount + category + paid-by + add)
  rather than the full `ExpenseFields`, since date/location/title are inherited.
- No new table, no new action, no event schema change.

## Plumbing

`ItineraryTab` currently receives `tripId, tripSlug, tripName, destination,
tripStartDate, tripEndDate, today, initialItems, initialLocations, budgetItems`.
It does **not** receive the data an expense needs. Thread three new props from
`page.tsx` down to the event row:

- `categories: ExpenseCategoryRow[]`
- `members: Record<string, MemberToneEntry>` (for the paid-by toggle)
- `currentUserId: string` (paid-by default)

The day already carries `dayDate` and `locationId`, so those need no new
plumbing — they pass down with the day.

## Both modes (planning vs. on the road)

Identical behavior in both. Planning = logging an estimated spend ahead of time;
on-the-road = logging the actual spend. Both are just a real expense row, so no
mode-specific branching.

## Out of scope (YAGNI)

- No expense id stored back on the event (no 1:1 link).
- No editing/removing the expense from the itinerary — managed in the Budget tab.
- No per-event or per-day running total shown on the itinerary.

## Files likely touched

- `src/app/trips/[slug]/page.tsx` — pass `categories`, `members`,
  `currentUserId` into `ItineraryTab`.
- `src/app/trips/[slug]/itinerary-tab.tsx` — thread props to the event row; add
  the `€ +` trigger and the compact inline expense form.
- Possibly a small new client component for the inline form (mirrors
  `QuickExpense`) to keep `itinerary-tab.tsx` from growing.
