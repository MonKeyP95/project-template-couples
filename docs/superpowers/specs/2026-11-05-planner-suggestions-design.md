# Planner suggestions — design

Date: 2026-11-05. Status: draft for review.

## Intent

The new-trip flow changed (note, length, budget, place, then stay/move/acts/food/avoid). The itinerary planner still reads inputs the flow no longer collects, and its Generate step writes the assistant's ideas straight into the itinerary — where most of them are silently dropped on days that are already planned.

The vision: the couple enters what they know; the assistant **fills the gaps with suggestions only**; the couple reviews and picks. A picked suggestion lands in both places it belongs — the itinerary (the activity) and the budget (its price) — so the two planners share data without the user ever thinking about two planners.

## Goals

- The planner reads exactly what the new-trip flow and the planner walk provide.
- The assistant never writes a real event or a real number on its own. It only suggests.
- Suggestions on planned days are possible, but never flood a day: they wait in a box.
- Two kinds of suggestion: **big** (an activity worth comparing) and **small** (eat/drink).
- Picking one writes the event and the budget line in one step, and asks whether it's already paid.

## Non-goals

- A manager/orchestrator assistant that routes between skills. The user sees "the assistant"; underneath, the planner returns suggestions with options attached and the pick writes to both. Orchestration stays a future direction (see memory: proactive assistant).
- Changing how the basic itinerary/budget are created at trip creation (separate, later).
- Realtime sync of the suggestion box between two browsers (refresh is fine).
- Vibe cleanup outside the planner (edit form, walkthrough, discover still use it).

## Anti-goals

- A day crowded with suggestions the couple didn't ask for.
- Any money appearing as spent without the couple saying it was paid.
- Invented places, prices or links once real search is in (piece C).

## Pieces, in order

### A. Planner input cleanup (small)

- Remove `vibe` and `activityTypes` from `ItineraryDraftContext`, the prompt, and the caller in `draftAndApplyItinerary`.
- Keep: destination, start date, day count, places, brief (`idea` = the note), prefs (stay/move/acts/food), avoid, known plans, free text, profile block, taste directive.
- The budget is **not** passed (decided: the itinerary planner plans days; the note already carries any budget wording).

### B. Suggestions with mock options

**Generate, rewired.**
1. The couple's walk entries are written as real events through the existing **Apply** path (`applyPlanEntries`), which already patches, adds and deletes correctly. This removes the two Generate bugs found on 2026-11-05: drafted days dropped on planned days, and walk edits not saved by Generate.
2. The model is asked only for **new ideas** (it no longer re-proposes the couple's plans). Each idea: `kind` (big | small), `category`, `title`, `place`, `day` (0 = no preference), short `why`.
3. Each idea becomes a row in `trip_suggestions`. The **server** decides where it shows: if its day is a blank day, it sits on that day; otherwise (planned day, or no day) it goes to the box.
4. Generate replaces the trip's remaining suggestions (no pile-up across runs). Anything the couple wanted is already a real event by then, since a suggestion only stays a suggestion until it is saved through the event form.
5. Prompt caps the count: roughly one big idea per place plus a few small ones. *(My call; tune in-app.)*

**Storage — new table `trip_suggestions`** (approved 2026-11-05):

| column | notes |
|---|---|
| id, trip_id, created_by, created_at | standard |
| kind | `big` \| `small` |
| category | one of the itinerary categories |
| title | "Kayak trip" |
| location_id | nullable |
| day_index | nullable; null = in the box |
| why | one line |
| options | jsonb array of `{ name, location, price_cents, price_unit: "total" \| "per_person", url, reviews }`; null until fetched |

RLS: trip members read/write, same pattern as `trip_budget_items`. Idempotent migration, applied by hand.

**Mock options.** In B, options come from a deterministic mock function: 3 options for big, 1 for small, plausible names/prices, `example.com` links, clearly labelled as sample data in the card. The model call for the ideas themselves stays real.

**UI.**
- A suggestion on a day shows as a single line, labelled **Suggestion**, visually distinct from real events.
- The **suggestion box** sits with the itinerary (above the days on mobile; side column on desktop). Each card can be **dragged onto a day** (existing dnd-kit setup in `itinerary-tab.tsx`).
- Every card has **Dismiss** (deletes the row).

**Adding a suggestion — one flow** (decided 2026-11-05). A suggestion only ever becomes real through the day's normal event form; it is never written as an event on its own.

1. **Start:** drag a box card onto a day, or tap a suggestion that already sits on a day (the day is then known).
2. **Big only — choose:** the options open side by side (location, price, link, reviews); the couple picks one. Small cards skip this (their one place is the choice).
3. **Event form, pre-filled:** the day's existing event form opens with `text` = option name, `url`, `category`, `details` = location. The couple adds the time (and anything else) and saves. Reuse the day form that already opens on an event.
4. **On save:** the event is written through the existing day-save path (fills a blank day, appends to a planned one) and the suggestion row is deleted.
5. **If the option has a price:** ask **"Did you pay for this already?"**
   - Creates a `trip_budget_items` row (category, subject, amount, location, `estimated = true`, `source_url`).
   - **Yes:** marks it paid through the existing mark-paid action (logs the expense, links `paid_expense_id`; paid by the current user).
   - **Not yet:** leaves it as a planned cost.

**Cancel** at any step: nothing is written; a dragged card goes back to the box. So no suggestion ever sits on a day half-chosen.

Per-person prices: the budget amount is price × number of trip members. *(My call — the couple can edit the line.)*

### C. Real options

- Replace the mock function with a real search **on first open** of a card (like `dispatch-detail`), then store the result in `options` so it's searched once. *(My call: lazy, so unopened suggestions cost nothing.)*
- New agent descriptor (e.g. `suggestion-options`) built on the `discover` pattern: `web_search_short`, a forced tool, every option must carry a real `sourceUrl`; price and reviews only if the search shows them, else omitted.
- Big: 2–3 comparable options. Small: one place.

## What's left to the builder

- Exact card visuals within `docs/DESIGN.md`.
- Where the box sits on desktop's 3-column layout.
- Prompt wording.

## Success criteria

**A — verified by Claude**
- `vibe` and `activityTypes` no longer appear in `itinerary-planner.ts` or `draftAndApplyItinerary`.
- `pnpm build` and `pnpm lint` clean.

**A — verified by the user in-app**
1. Generate on a new-flow trip still produces an itinerary with no error.

**B — verified by Claude**
- Migration is re-runnable; `trip_suggestions` has RLS policies matching `trip_budget_items`.
- Generate writes the couple's entries through `applyPlanEntries` and the model's ideas only to `trip_suggestions`; no model idea is written to `itinerary_days`.
- An idea whose day is a blank row gets that `day_index`; an idea on a planned day gets `day_index = null`.
- Saving a suggestion's event form writes one event on that day and deletes the suggestion row; cancelling writes nothing.
- The paid answer "not yet" creates one budget item; "yes" also creates one linked expense.
- Build and lint clean.

**B — verified by the user in-app**
1. After Generate, empty days show suggestions labelled as such; planned days show none; the rest are in the box.
2. Dragging a small card onto a day opens the event form pre-filled (name, link, category, location); saving with a time adds a real event on that day.
3. Dragging a big card onto a day shows its 3 options first; choosing one opens the pre-filled event form.
4. Cancelling at any step writes nothing and the card is back in the box.
5. After saving a priced suggestion, "Not yet" adds a planned cost under the right budget category; "Yes" also adds an expense.
6. Dismiss removes a card; Generate again does not pile up old cards.
7. Works on a phone viewport.

**C — verified by Claude**
- Every stored option has a non-empty URL from a search result.
- Opening a card a second time does not trigger a second search.

**C — verified by the user in-app**
1. Options are real places with working links and plausible prices.
