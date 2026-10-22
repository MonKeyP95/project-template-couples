# New trip flow - design

Date: 2026-10-22. Source mock: the "New trip flow" design canvas
(https://claude.ai/artifact/9WUKu5dVCpDxWoyN2DUUq3, `project/Main.dc.html`), a
390x844 click-through. This spec replaces today's `/trips/new` form
(`src/app/trips/new/new-trip-form.tsx`).

## Why

The user's planning vision, in order:

1. **Trip idea -> basic profile** (this project).
2. **The couple adds their own data** on the trip page: what to do each day,
   budget, flight tickets, expected spend. Mostly exists already.
3. **Assistant, optional**, fills the gaps and suggests ideas.
4. **The couple reviews and confirms** what it suggests.

Steps 3-4 are a later, separate project. This project is step 1: a calm,
low-effort way to start a trip from how you'd describe it out loud, with the
three fixed inputs (how long, where/what, budget) up front and softer
preferences after.

Today's form asks for name, slug, a dream checkbox, start + end dates,
country, lat/lng, then a vibe/transport/categories walkthrough. Too much, in
the wrong order.

## Goals

- One flow for trips and dreams. No "this is a dream" choice. A trip with
  dates is labelled a trip, without dates a dream; that is the only difference
  (the data model already works this way: `start_date IS NULL` = dream).
- Page 1 is the basic profile, on one page. Page 2 is optional preferences.
- A dateless trip still knows how long it is, and shows that many empty day
  slots on its itinerary.

## Non-goals

- The gap-filling assistant (vision steps 3-4).
- Redesigning the edit page (`/trips/[slug]/edit`). It keeps its own dream
  toggle and layout; it only gains the fields listed under "Edit page".
- A desktop-specific layout. The same page, centred, is fine on desktop.
- AI reading of the free text. Pattern matching only (user's decision).
- Changing older trips' stored profiles.

## Anti-goals

- Asking for something the text already said.
- Forcing a place: "Not sure yet" must create a trip with no place.
- Guessing a country from a place (see the location memory: never assume
  geography). The place is stored as typed.

## The flow

### Page 1 - basic profile (one page, top to bottom)

1. Eyebrow "New trip", serif headline "Tell me about the trip.", sub-line
   "However you'd say it. How long, where or what, roughly what it costs."
2. **Free-text note** (textarea, placeholder "2 weeks surfing"), with "Try
   one:" example chips that fill the textarea (the mock's three examples).
3. **How long** - number of days, required (>= 1). Under it "+ Add dates",
   which reveals one start-date input; the end date is shown as
   "to {day}" = start + days - 1, in `en-GB` (`Sat 4 Jul`). Dates optional.
4. **Budget** - whole-trip amount in the workspace currency, optional.
5. **Where?** - two states (user's decision):
   - The note names no place: the full "Where?" question - text input plus
     a "Not sure yet" toggle chip (as in the mock).
   - The note yields a place: a small editable line instead, "Where:
     Portugal", so a wrong pick ("Celebrate") is visible and fixable before
     creating. Editing it marks the field touched.
6. **Continue** - disabled until days >= 1.

**Live prefill.** As the note changes, the mock's parsers
(`parseDays`, `parseBudget`, `parseWhere`, `parseWhat`) run and fill days,
budget and place. A field the user has typed into themselves is never
overwritten by the parser afterwards (per field "touched" flag).

Parser details (my calls): `parseBudget` takes the workspace currency and
matches its symbol and code (and "eur"/"euros" when it is EUR), plus the bare
"budget 2k" form; amounts in another currency are ignored. `parseWhere`
ignores month and weekday names ("a week in May" yields no place).

The mock's separate "Got it / A few more things" screen is gone: its job is
done by the fields living on page 1.

### Page 2 - optional (as in the mock)

"<- Back" and an "Optional" eyebrow. Headline from what/place:
`"{What} in {Place}"`, else what, else place, else "A trip". Sub-line as in
the mock. Five labelled textareas, pre-filled from the note by the mock's
`prefill` (split on `, . ;` and "and", keyword regex per topic):

| key   | question                  | hint (placeholder) |
|-------|---------------------------|--------------------|
| stay  | Where will you sleep?     | Camping, or that surf hostel in Ericeira we saw... |
| move  | How will you get around?  | Rent a van, trains between towns... |
| acts  | What will you do?         | Surf lessons in the mornings, one day in Lisbon... |
| food  | Groceries or eating out?  | Mostly cooking, one nice dinner out... |
| avoid | Anything to avoid?        | Crowded beaches, long drives... |

Buttons: **Skip** and **Create trip**. Both create the trip; Skip saves
without the page 2 answers. Back keeps everything typed.

After creating: navigate to `/trips/{slug}` (the one-page trip on mobile).

## What gets saved

| Input | Where |
|-------|-------|
| note | `trip_profile.idea` |
| page 2 answers | `trip_profile.stay / move / acts / food / avoid` (free text; `avoid` already exists) |
| days | new column `trips.day_count` - only for dateless trips (see below) |
| start date | `start_date`; `end_date` = start + days - 1 |
| budget | `planned_budget_cents` (whole units x 100) |
| place | `trips.country` (the existing destination column, stored as typed); null when "Not sure yet" or empty |
| name | the page 2 headline (`"Surfing in Portugal"`, else "A trip") |
| slug | `slugify(name)`; on collision append `-2`, `-3`, ... |

Unchanged from today: `currency`/`home_currency` copied from the workspace,
`trip_members` rows for every workspace member, default expense categories
seeded. `lat`, `lng`, `fuzzy_when` are left null. `vibe`, `vibeNote`,
`transport` are saved empty.

### `day_count`

A dated trip's length is its dates; a dateless trip has nowhere to keep "10
days", so: `alter table trips add column if not exists day_count int check
(day_count is null or day_count >= 1)`. Written on create when there are no
dates; null for dated trips. Re-runnable migration file (memory: idempotent
migrations, applied by hand in the SQL editor).

Cleared to null when a dream is promoted to dated (see "Promotion" below).

### Trip profile type

`TripProfile` (`src/lib/trips/trip-profile-types.ts`) gains `stay`, `move`,
`acts`, `food: string` (empty default; `parseTripProfile` reads them as
strings or ""). `vibe`, `vibeNote`, `transport` stay in the type so old trips
still parse and show them. `createTrip` stops requiring `isDream`, `slug`,
`fuzzyWhen`, `lat`, `lng`, `categories` from this form.

## The trip page after create

Mostly exists (`src/app/trips/[slug]/mobile-trip.tsx` and the desktop page).
Changes:

1. **Trip card rows** show Sleeping / Getting around / Doing / Eating / Avoid
   from the new fields, empty ones hidden (as in the mock's `summary`). Old
   trips with only vibe/transport keep showing those (show whichever is
   non-empty).
2. **Itinerary line / day count.** For a dateless trip, `dayCount` =
   `day_count` when set (else today's fallback: number of dream rows). The
   line reads "10 days · no dates yet". The budget card's "about €X a day"
   then works for dreams.
3. **Empty day slots on a dateless trip.** The dream itinerary
   (`dream-itinerary-tab.tsx`) shows positions 1..`day_count`. A position with
   no row renders as a dashed "Day N  + add" slot (mock style); tapping it
   adds a day at that `day_index`. Rows beyond `day_count` still show (count
   is a plan, not a cap). Today's "+ add day" (append at max+1) stays.
   Needs an add-at-index variant of the dream add action
   (`src/lib/trips/actions.ts:2401`, currently append-only).
4. **Promotion keeps positions and length.** Today
   `promote_dream_to_dated`
   (`supabase/migrations/20260530000002_promote_dream_to_dated.sql`) maps rows
   to consecutive dates by `row_number()` and sets the trip length to the row
   count. With slots that is wrong: a 10-day dream with only Day 3 filled
   would become a 1-day trip dated on Day 1. New version (new re-runnable
   migration, `create or replace`): row `day_index k` -> `start + k - 1`;
   `end_date = start + greatest(day_count, max(day_index)) - 1`; set
   `day_count = null`. Dreams with zero rows keep today's path in
   `updateTrip` (`src/lib/trips/actions.ts`, the "normal dated edit"
   branch), which should also clear `day_count`. The edit form is otherwise
   unchanged.

5. **Positions are real only when `day_count` is set** (my call). For such
   dreams "Day N" is the row's `day_index`; deleting a day leaves an empty
   slot in place; drag-reorder stays as today (rows swap among filled
   positions, no dragging into an empty slot). Dreams with `day_count` null
   (all existing dreams) keep today's compacted ordinals and today's
   promotion (compact by `row_number()`, length = row count).
6. **Keep the new keys on every save** (my call). `updateTrip`'s
   `profilePatch` and `saveTripProfile` rebuild `trip_profile` from the old
   keys only and would wipe `stay/move/acts/food`; both must carry them
   through.
7. **AI context reads the new fields** (agreed in conversation).
   `src/lib/ai/profile-context.ts` adds Sleeping / Getting around / Doing /
   Eating lines from `stay/move/acts/food` when non-empty.
8. **Budget line items overwrite the typed budget** - today
   `saveBudgetItems` sets `planned_budget_cents` to the sum of items. Kept as
   is in this project (my call); the typed figure is a starting point.

## Edit page

User's decision: the couple must be able to change these after creating.
`edit-trip-form.tsx` gains, in its existing style:

- The five page-2 answers (stay, move, acts, food, avoid) as textareas;
  `avoid` already exists there, so four new ones. Saved through
  `updateTrip`'s profile patch.
- **How long** (days) when the trip is dateless - writes `day_count`.
  Hidden for dated trips (their length is the dates).

The vibe/transport chips on the edit page stay for now (old trips use them).

Planning vs on the road: creation is a planning-mode action; if the start
date is today or earlier the trip page's existing dates-driven road mode takes
over. Nothing new needed.

## Constraints

- Mobile-first; touch targets >= 44px; the existing sand-and-sea tokens and
  fonts (serif headline, mono eyebrows), not the mock's raw OKLCH values.
- Client component for the form (live parsing); `createTrip` stays a Server
  Action. Parsers live in a pure module (no `next/headers`), e.g.
  `src/lib/trips/trip-note-parse.ts`.
- Dates displayed `en-GB`, day before month.
- No emojis; sparse comments; short functions.

## Left to the builder

- Component split for the two pages; whether page 2 is a second route or
  in-page state (in-page state is the simpler default).
- Exact behaviour of "+ Add dates" once open (no close control needed).
- Validation copy for server errors.

## Success criteria

Verified by Claude:

1. `pnpm build` and `pnpm lint` clean.
2. Parser module returns, for the mock's examples: "2 weeks surfing" ->
   days 14, what "Surfing", no place, no budget; "10 days in Portugal, 1500
   eur" -> 10, place "Portugal", budget 1500; "a week hiking in the Alps,
   budget 2k, we cook" -> 7, place "Alps", what "Hiking", budget 2000, food
   prefill "we cook".
3. `createTrip` with no dates writes `start_date`, `end_date` null and
   `day_count` = days; with a start date writes `end_date` = start + days - 1
   and `day_count` null.
4. `createTrip` writes the five answers into `trip_profile` and the note into
   `trip_profile.idea`; budget into `planned_budget_cents`; place into
   `country` (null for "Not sure yet").
5. Slug collision yields `-2` instead of an error.
6. Migration files are re-runnable (`if not exists`, `create or replace`).
7. Saving the edit page keeps `stay/move/acts/food` in `trip_profile`, and
   writes `day_count` for a dream.
8. New `promote_dream_to_dated`: a dream with `day_count` 10 and one row at
   `day_index` 3, promoted with start 2026-07-01, yields `end_date`
   2026-07-10, the row on 2026-07-03, `day_count` null.

Verified by the user in-app:

1. On a phone viewport, `/trips/new` shows note, how long, budget on one page;
   typing "10 days in Portugal, 1500 eur" fills days 10 and budget 1500 and
   shows "Where: Portugal" as a small editable line, not the full question.
2. Typing "2 weeks surfing" shows the Where? field; "Not sure yet" lets you
   continue.
3. "+ Add dates" with a start date shows the right "to {day}" end.
4. Continue is disabled until days is filled.
5. Page 2 shows "Surfing in Portugal"-style headline and pre-filled answers;
   Back keeps everything.
6. Create lands on the trip page; the trip card shows the answers; a dateless
   trip says "N days · no dates yet" and lists N empty "+ add" day slots.
7. Tapping an empty slot adds a day at that position.
8. Home lists the new trip under Dreams when dateless, Trips when dated.
9. Promoting that dream on the edit page keeps Day 3 on the third date and
   the trip 10 days long.
10. The edit page shows the five answers and, for a dream, How long; changing
    them and saving shows the new values on the trip page.
