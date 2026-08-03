# On-the-road dispatch box — design

Date: 2026-08-03
Status: ready for a plan

## Goal

Replace the static weather card at the top of `/on-the-road` with **one rotating
box** that carries the weather plus up to two AI-sourced items about what is
actually happening where the couple is today: a festival, a strike, the swell.

The box is **read-only ambient information**. It is not a suggestion surface —
suggestions already live in the assistant block and stay there.

## What it is not

Ruled out during brainstorming, recorded so they are not re-litigated:

- **Not a feed.** No accumulating timeline, no scroll-back, no per-item history.
  One box, one day, replaced tomorrow.
- **Not a budget readout.** `PaceLine` already renders budget pace on this page
  and stays exactly where it is. A budget card in the box would be a second
  reading of the same number on one screen.
- **Not actionable.** No "add to today", no apply, no write path of any kind.
  Cards link out to their source and that is all they do.
- **Not general news.** See the content contract below.
- **Not a new interests field.** The agent reads the context that already exists.

Everything on `/on-the-road` other than the weather card is untouched: assistant
block, Today, cap nudge, `PaceLine`, catch-up nudge, quick expense, quick note,
Looking Ahead.

## Content contract

Four things could be called "news from here". Three are in, one is out:

| Kind | In? | Examples |
|---|---|---|
| `whats_on` | yes | festival, Sunday market, saint's day, concert, match, public holiday that closes things |
| `disrupted` | yes | transport strike, road or museum closure, protest route, storm or heat warning |
| `conditions` | yes | swell, snow, tide, jellyfish, air quality — the personalised kind |
| general headlines | **no** | politics, crime, economy |

The rule the agent follows: **actionable or delightful, nothing else.** Items in
the first three kinds change what the couple does today or are a genuine
pleasure to know. General headlines change nothing about the day and can land
badly when you are a guest somewhere.

Two hard requirements on every item:

- **`sourceUrl` is mandatory** — a real search result, same discipline as
  `discover`. No invented festivals.
- **`window` is mandatory** — a date or span (`Sat 8 Aug`, `through the
  weekend`). Undated items are how the card degrades into guidebook prose
  ("Ericeira is known for its beaches"). If the model cannot date it, it is not
  a card.

**Zero items is a valid, expected answer** and must be stated as such in the
prompt. Most days in most places have no festival and no strike. An agent
obliged to fill a slot fills it with filler, and filler at the top of the most-
visited screen teaches the user to stop reading the box.

### Why interests are inferred, not declared

The `conditions` kind is what makes "we surf, so show us the swell" work. That
signal comes from context the app already holds — trip vibe, trip brief, the
taste profile, the itinerary — via `buildAssistantContext` and
`TASTE_DIRECTIVE`, exactly as `discover` consumes them. No new interests column,
no per-hobby API integration.

The known weakness: inference gets the long tail **only when the signal is
sharp**. A profile reading "seafood, slow mornings, coastal" will not yield "check
the swell". When the signal is weak the correct output is zero items, not a
generic line. This is the main thing to watch when tuning the descriptor.

## Architecture

### Table `trip_dispatch`

One row per trip per day. The row *is* that day's dispatch.

| column | type | notes |
|---|---|---|
| `id` | uuid | pk |
| `trip_id` | uuid | fk trips, cascade |
| `day_date` | date | unique together with `trip_id` |
| `items` | jsonb | array, 0–2 entries |
| `generated_at` | timestamptz | default now() |

Item shape: `{ kind, title, body, window, sourceUrl }` where `kind` is
`whats_on | disrupted | conditions` and `body` is one line.

RLS by workspace membership, same policy shape as `trip_notes`. Migration must
be re-runnable and is applied by hand in the SQL editor.

### Agent `src/lib/ai/agents/dispatch.ts`

The seventh descriptor, run by the shared `runAgent`, exported through
`src/lib/ai/claude.ts` as `generateDispatch`. `mcpServers: []` like the rest.

- **Tools**: server-side `web_search`, plus a `propose_dispatch` tool the agent
  calls with the structured items.
- **System prompt** owns the content contract above: the three kinds, headlines
  excluded, `sourceUrl` and `window` mandatory, max two items, zero valid.
- **Context**: `buildAssistantContext` + `TASTE_DIRECTIVE` + today's location,
  date and itinerary.

To change the card's behaviour, edit this one file. Do not extract a shared
"card policy" layer, and do not make the prompt editable at runtime. If a second
agent ever needs the same rule, export a constant then — the `TASTE_DIRECTIVE`
precedent — not before.

### Generation: once a day, persisted

`/on-the-road` reads the `trip_dispatch` row for today. If it is missing, a small
client component fires the `ensureDispatch(tripId, dayDate)` server action once
after paint; the box fills in when it lands.

- **Page render never waits on Claude.** Every model call in this app today is
  triggered by a click; this is the first that is not, and it must not sit in the
  render path of the page opened most often on a trip, on a phone, on hotel wifi.
- **A row with zero items still counts as generated.** That is what stops a quiet
  day re-searching on every page load.
- **`isAiEnabled` false** → no call, weather only.
- **Location searched** is the location of today's itinerary day
  (`todayDay.locationId`), falling back to `trip.country`. Travel days get no
  special handling: the day belongs to one location and that is the one searched.
- **No force-regenerate in v1.** A refresh button invites rerolling until the
  card is interesting, which is a cost loop and a symptom-fix. Dull cards are a
  prompt problem; the fix is editing the descriptor.

Cost ceiling: one search turn per trip-day.

## The box

`src/components/dispatch-box.tsx`, a client component, sitting in the headline
section exactly where `WeatherCard` sits today — same chrome, same width, same
place. What changes is that it holds a stack instead of one thing.

**Stack contents**, in order: the existing `WeatherCard` unchanged (raw
conditions, no interpretation layer), then 0–2 dispatch items. Each item renders
as a small kind label (*What's on* / *Heads up* / *Conditions*), the title
linking to `sourceUrl`, one line of body, and the window.

**Rotation.** Auto-advances every 7s and wraps. Dots underneath show position and
are tappable to jump. Pauses on hover, focus, or touch and stays paused while the
user is interacting. Under `prefers-reduced-motion` it does not auto-advance at
all — dots only.

**One card = no carousel.** When there is only weather: no dots, no timer, no
wrapper affordances, rendering identical to the current page. This is the
quiet-day state and it should be the common one. The feature degrades to today's
design, not to an empty hole.

**Fixed height** to the tallest card in the stack. A weather card and a two-line
festival card differ in height, and reflowing the page every 7 seconds would be
worse than any other problem in this design.

### Start position

- **First visit of the day → weather.**
- **Every later visit that day → a random *dispatch* card** (not a random card
  from the whole stack).
- **No dispatch items** → nothing to randomise; static weather.

The reasoning, since this is the least obvious decision here. The timer resets on
every page load, so weather-always-first means weather occupies the box for the
first 7 seconds of *every* visit — and `/on-the-road` visits are frequently
shorter than that (open, log a coffee, close). Any visit shorter than the dwell
time would show weather and nothing else. Not "less often" — never. Repeat visits
do not rescue it, because the position does not persist.

Randomising over the whole stack fixes coverage (P(miss across three visits) ≈
4%) but makes weather — the one card with a question attached to it — take up to
14 seconds or a tap to reach. Randomising over dispatch items only takes exposure
to effectively 1.0 per later visit *and* keeps weather instant on the first visit
and one dot away thereafter.

The justification for randomness here is **coverage, not engagement**.
Variable reward does pull attention harder, but deliberately engineering a
slot-machine mechanic into a calm trip-planning app is off-register for
`DESIGN.md`. Same code, honest rationale.

**Two implementation consequences:**

- "First visit of the day" is **per-device**, not per-trip — each partner gets
  their own first visit. `localStorage` keyed by trip + date, not a column.
- The random index **must be chosen after mount.** The box is a client component
  and Next.js server-renders those, so `Math.random()` at render time is a
  hydration mismatch. It renders weather first and switches in an effect.

## Scope

`/on-the-road` only. Extending the box to `/home` or the trip page is explicitly
out of scope for this slice.

## Success criteria

### Verified by Claude

1. `pnpm build` passes and `pnpm lint` is clean.
2. `supabase/migrations/` gains a re-runnable file creating `trip_dispatch` with
   the unique `(trip_id, day_date)` constraint and RLS policies scoped to
   workspace membership, matching the `trip_notes` policy shape.
3. `src/lib/ai/agents/dispatch.ts` exists as a single descriptor with
   `mcpServers: []`, is executed by `runAgent`, and is exported through
   `src/lib/ai/claude.ts`. No new provider abstraction is introduced.
4. The descriptor's system prompt states all five content rules: the three
   permitted kinds, general headlines excluded, `sourceUrl` mandatory, `window`
   mandatory, and zero items valid.
5. `ensureDispatch` writes exactly one row per `(trip_id, day_date)`; calling it
   twice for the same day does not produce a second row and does not issue a
   second model call.
6. An agent result with zero items still writes a row.
7. `isAiEnabled` false results in no model call.
8. `/on-the-road`'s server component does not await `generateDispatch` — the
   dispatch read is a table read only.
9. `PaceLine`, both nudges, `QuickExpense`, `QuickNote`, `TodayUpcoming`,
   `TodayPast` and `LookingAheadPanel` are unchanged, and `WeatherCard` is
   rendered by the box rather than deleted.
10. With one card in the stack, the box renders no dots and starts no timer.
11. No `Math.random()` or `localStorage` access during render.

### Verified by the user in-app

1. On a quiet day (no dispatch items) the top of `/on-the-road` looks the same as
   it does today — no dots, no motion.
2. On a day with items, the box advances roughly every 7 seconds and wraps.
3. Touching or hovering the box stops it advancing, and it stays stopped.
4. Tapping a dot jumps to that card.
5. The first load of the day shows weather; a later load the same day opens on a
   dispatch card.
6. The box does not change height as it rotates, and the page below does not
   shift.
7. With OS "reduce motion" on, nothing auto-advances but the dots still work.
8. Item titles open a real, relevant page in a new tab.
9. Every item shows a date or span — nothing undated appears.
10. Items are recognisably about *this* place and *these* dates, not generic
    guidebook lines about the country.
11. The box reads as calm at a phone viewport and does not crowd the headline.
