# Restaurant discovery agent — design

**Date:** 2026-06-29
**Status:** Design — brainstormed 2026-06-29; on-the-road door added 2026-06-29.
Ready to slice into a plan.
**Phase:** 5 (AI assistant). Builds on the real-Claude seam wired in slice 0
(`lib/ai/claude.ts`, `pingClaude`).

> **Two modes.** Per the app's planning-vs-on-the-road principle
> (`docs/VISION.md`), discovery has **one engine, two front doors**: a deliberate
> planning door in the Assistant (pick a future day) and an on-page on-the-road
> door (now / near us / this meal). See §6.

## What

A **preference-aware restaurant discovery agent**. With AI mode on, you ask the
Assistant for a place to eat ("find us somewhere for tomorrow"); Claude runs a
**grounded web search**, reads the couple's stored tastes, and returns a small
**cited** shortlist. You book it yourself off-app, then **confirm the pick into
the itinerary as an event**. After the meal, a quick **good / bad** rating is
captured for later learning.

Restaurants only for v1. Suggest-only: `lib/ai` returns a proposal; the existing
Server Actions do every write.

## Why

People plan around a couple of standout meals, but the good long-tail spots
(family trattorias, the place locals rate) live on their own sites and Google,
not on the booking aggregators. We can't and shouldn't scrape or drive a logged-in
Booking.com session (ToS wall, anti-bot, stored-password risk — see the
brainstorm that produced this spec). The legitimate, higher-value move is **open
web search + the couple's own preference data** — the personalization comes from
data we own, not from prying into someone else's account.

This is also the first AI surface that calls the real model on demand. Every prior
surface is mock-first and proactive (`suggestionFor`, `planBudgetSteps`,
`requestChatReply`). A discovery query can't be mocked — its value is a real model
reading the live web — and it's **on-demand**, so we only spend tokens when the
user asks, never to fill background cards.

## Scope

**In (v1):**

1. A **preferences profile** per workspace (budget band, vibe tags, dietary,
   cuisines) that seeds every search.
2. An **on-demand discovery flow** in the Assistant (AI mode on) → one Claude call
   with web search → a cited restaurant shortlist.
3. **Accept a pick → itinerary event** via the existing events model.
4. **Feedback capture** (good / bad) on a past AI-suggested restaurant event,
   stored but not yet used.

**Out (deferred):**

- Hotels and activities (restaurants first; the same seam widens later).
- Multi-time / multi-day or recurring events — that's a change to the itinerary
  *event model itself*, tracked separately, not reshaped here.
- **Using** the feedback signal to re-rank future searches (the "learn from
  history" layer — needs trip history first).
- Natural-language intent routing of free chat (v1 uses an explicit affordance —
  see Design §3).
- In-app booking, live prices, persisted/shared shortlists.

## How Claude searches

Single Claude call through `lib/ai/claude.ts`, using Claude's **built-in
server-side web search tool** (`web_search_20260209`):

- **No second vendor or key.** Search runs server-side and returns results with
  source URLs and citations built in — satisfying the "every suggestion links its
  source" rule without a Brave/Bing/Google integration. Keeps the "AI provider is
  one file" invariant.
- **Scoping is native.** `user_location` biases to the trip's destination;
  `blocked_domains` can drop the aggregators we deliberately skip.
- **Model:** the seam's default `claude-sonnet-4-6` already supports the web
  search tool; a one-line swap to an Opus 4.x model is the quality lever later.
- Pasted/searched content is untrusted, but it only ever yields a reviewed
  proposal before any write, so injection risk is low — a one-line note in the
  implementation, not a mitigation layer (mirrors the import-plan spec).

**Grounding rule:** every shortlist item carries its source URL, never stores a
scraped price as fact, and the UI nudges "verify on their site." Same
suggest-only, review-then-accept gate used everywhere else.

## Design

### 1. Preferences — new table + tiny editor

- Migration `…_dining_preferences.sql` (idempotent): a `dining_preferences` row
  per workspace — `budget_band` (text), `vibe_tags` (text[]), `dietary` (text[]),
  `cuisines` (text[]), timestamps. RLS via the existing workspace-member helper;
  one row per workspace (`unique (workspace_id)`).
- `src/lib/ai/dining-preferences.ts` — types + `getDiningPreferences(workspaceId)`;
  a `saveDiningPreferences` Server Action (upsert).
- A small editor on `/profile` (a "what we like" card) — explicit, transparent,
  editable. No onboarding gate; empty preferences just mean a broader search.

### 2. The seam — discovery call

- `src/lib/ai/restaurant-discovery.ts`: a `DiningSuggestion` type (name, one-line
  why-it-fits, area, price hint as *text not cents*, `sourceUrl`) and
  `findRestaurants(input)` where `input` carries the trip destination, the target
  day, and the loaded preferences.
- The one engine serves both doors (§3 planning, §6 on-the-road) without
  branching the seam. **As built (2026-06-29):** rather than add new typed
  fields, both doors reuse the existing `RestaurantQuery` shape —
  `destination` carries the location name (planning: the chosen day's location;
  road: today's location / trip city) and the free-text `when` carries the
  timing (planning: a date label; road: a meal phrase like "dinner tonight").
  No `nearLocationName`/`targetMeal` fields were needed (YAGNI).
- Internally calls a new `searchRestaurants(...)` in `claude.ts` (the only place
  that touches the SDK) — one `messages.create` with the web search tool, returning
  3–4 grounded suggestions via a structured tool/`output_config.format` shape.
- Route handler `GET/POST /api/ai/discover` (server-only, AI-mode-gated) so the
  key never reaches the browser — mirrors the slice-0 ping route.

### 3. Assistant entry point — `src/components/assistant.tsx` (planning door)

> This is the **planning door**. The engine is shared with the on-the-road door
> in §6; this one is the deliberate "pick a future day" entry point.

- When AI mode is **on** and the panel is open on a trip context, show a **"find a
  restaurant"** quick affordance (a chip in the composer). It asks which day
  (defaults to tomorrow / the trip's next day) and calls `/api/ai/discover`.
  - Decision: an explicit affordance, not free-text intent parsing, for v1. It's
    deterministic, token-frugal, and avoids misfires; natural-language routing
    ("find me a restaurant tomorrow") is a clean fast-follow once the loop is
    proven. Tradeoff noted, not blocking.
- Results render as cited `SuggestionCard`-style rows (moss border — the existing
  "AI, not yet committed" tone), each with name · why · source link, and an
  **Add to itinerary** action.
- Chat otherwise unchanged (still opens regardless of AI mode; the discovery
  affordance is the only AI-mode-gated part).

### 4. Accept → itinerary event

- **Add to itinerary** opens a minimal confirm (day + optional time, pre-filled)
  and calls the existing `addItineraryDay` / event-append action — an accepted
  restaurant becomes an ordinary day event (e.g. "Dinner · Trattoria X"), with the
  source URL kept in the event text/note. Once added it is indistinguishable from a
  hand-entered event. `lib/ai` writes nothing itself.

### 5. Feedback capture

- A nullable mark on the relevant event (or a light `event_feedback` row keyed to
  the trip + event) recording `good | bad` plus the suggestion's source, set from a
  small prompt on a **past** AI-suggested restaurant event (on the itinerary or the
  On-the-road page).
- v1 only **stores** it. Feeding it back into `findRestaurants` to bias future
  results is the deferred learning layer.

### 6. On-the-road door — on-page affordance on `/on-the-road`

The **road door** is the same engine (§2) reached from the day view instead of the
Assistant. Its whole point is staying in the surface you're already looking at:
now, near us, this meal, one tap.

- **Where.** A small block directly under the **Today** section (between
  `AddTodayEvent` and `QuickExpense`). AI-mode-gated, like all discovery — AI off,
  the block never renders.
- **Meal inference.** From the **local hour** (the page's existing timezone
  source — `localToday` / the timezone cookie): `<11:00` breakfast, `11:00–16:00`
  lunch, `≥16:00` dinner.
- **Visibility heuristic.** Show **only when today's events have no title
  containing the current meal word** (case-insensitive keyword match on the
  current slot — e.g. evening with no "dinner" event → show "Find dinner"). A
  fuzzy nudge, not a guarantee: a manually-named dinner with no "dinner" in the
  title is a harmless false gap (you just ignore the button). No event-model
  change (no meal tag) — the heuristic stands in for it.
- **Search.** On tap, POSTs to `/api/ai/discover` with `destination` = today's
  location name (fallback `trip.country` / `trip.name`) and `when` = a meal phrase
  ("dinner tonight"). No GPS in v1.
- **Results.** 3–4 **cited** rows inline (moss `SuggestionCard` tone), each
  name · why · source link, with an **"open hours — verify on their site"** nudge.
  "Open now" is only ever a prompt preference + this nudge, never a promise — web
  search can't know live hours.
- **Accept — one tap → today.** "Add to today" drops the pick straight onto
  today's events via the existing `addTodayEvent` action: day = today, event text
  = `"<Meal> · <Name>"`. No confirm dialog (day and meal are already known);
  editable afterward like any event. Contrast §3, where the planning door keeps
  its day-picker confirm because there the day is a decision.
  - **As built (2026-06-29):** `ItineraryEvent` is `{ time, text }` only — there
    is no note field — so the source URL is **not** stored on the event; it lives
    in the suggestion row (with the verify-hours link) that you see before
    accepting. Storing it would require an event-model change, which is out of
    scope.
- **No-location case.** `todayDay.locationId` null → fall back to the trip
  city/country. No "where am I" prompt; GPS precision is the deferred upgrade to
  the engine's `user_location` input.
- **Feedback (§5) needs nothing extra.** An accepted road pick is an ordinary
  event, so the same later good/bad mark (already spec'd for the On-the-road page)
  covers it.

### 7. Auth'd, preference-aware route (slice B2)

Slice B1 shipped `/api/ai/discover` as a body-driven smoke route (destination +
when + defaults, briefly public). B2 turns it into the real endpoint — a thin
enrichment seam that loads the couple's preferences server-side. **Decision
(2026-06-29): preferences-only enrichment; the doors are unchanged.**

- **One file changes:** `src/app/api/ai/discover/route.ts`. `claude.ts`,
  `searchRestaurants`, `RestaurantQuery`, and the doors stay as they are.
- **Gate:** keep the `isAiEnabled()` 403. The proxy already requires a session
  (the B-road re-gate removed the temporary `PUBLIC_ROUTES` entry), so the route
  assumes an authenticated request.
- **Resolve → preferences:** `getCurrentWorkspace()` (resolves the user and
  workspace; returns `null` when unauthenticated or workspace-less → the route
  returns 401) → `getDiningPreferences(workspace.id)` (slice A;
  `src/lib/preferences/dining-queries.ts`).
- **Build the query:** take only `{ destination, when }` from the body (what the
  door knows) and fill the rest of `RestaurantQuery` from the loaded preferences
  (`budgetBand`, `vibeTags`, `dietary`, `cuisines`). Preferences are
  server-authoritative; any preference fields in the body are ignored.
- **Why preferences-only, not a `tripId`:** the doors already compute the
  destination/when more precisely than a trip row would (on-the-road uses today's
  *location*, not the trip country). The only thing a door cannot know is the
  workspace-scoped preferences, so that is all the route adds. Loading a trip
  server-side would make the on-the-road door *worse*. Mode-agnostic by
  construction: both doors send `{destination, when}` and get the same
  enrichment.
- **Comment:** drop the "temporary smoke route" framing.

## Build slicing (validate each step)

The full vision is v1, but build it in validated sub-steps:

- **A — Preferences:** table + `/profile` editor + queries. Shippable alone.
- **B1 — Discovery seam (shipped):** `claude.ts` web search + the
  `RestaurantQuery`/`RestaurantSuggestion` types + a body-driven smoke
  `/api/ai/discover`. Proved search quality/cost/latency in isolation.
- **B2 — Auth'd preference-aware route (§7):** turn the smoke route into the real
  endpoint — auth → workspace → `getDiningPreferences` merged into the query;
  doors unchanged.
- **B-planning — Assistant planning affordance:** the composer chip + cited
  results in the Assistant (the planning door, §3). Not yet built.
- **B-road — On-the-road door (§6):** the on-page meal-aware affordance on
  `/on-the-road` (meal inference + visibility heuristic + one-tap "Add to today").
  Depends on B; the planning and road doors share its engine.
- **C — Accept → event:** the Add-to-itinerary confirm wired to existing actions
  (the planning door's day-picker; the road door's one-tap accept rides on B-road).
- **D — Feedback capture:** the good/bad mark on a past event.

## Architecture invariants honored

- **AI provider is one file** — all SDK access stays in `claude.ts`.
- **Suggest-only** — `lib/ai` returns proposals; existing Server Actions write.
- **RLS from day one** — `dining_preferences` (and any feedback row) gated by the
  workspace-member helper.
- **Server-first / key server-only** — discovery runs in a route handler; the key
  never reaches the client.
- **Mobile-first** — the affordance and result rows are designed for the phone
  Assistant panel.
- **Idempotent migration**, applied by hand to the single shared Supabase project.

## Verification

- `pnpm lint` and `pnpm build` clean.
- With AI mode on, the Assistant returns 3–4 **cited** restaurants for a trip
  destination; each links its source.
- Accepting one creates a real itinerary event indistinguishable from a manual one.
- Preferences edit on `/profile` round-trips and visibly shifts results.
- Feedback mark on a past event persists.
- Tested on a 390px phone viewport.
