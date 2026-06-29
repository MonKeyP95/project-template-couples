# Restaurant discovery agent — design

**Date:** 2026-06-29
**Status:** Design — brainstormed 2026-06-29, ready to slice into a plan.
**Phase:** 5 (AI assistant). Builds on the real-Claude seam wired in slice 0
(`lib/ai/claude.ts`, `pingClaude`).

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
- Internally calls a new `searchRestaurants(...)` in `claude.ts` (the only place
  that touches the SDK) — one `messages.create` with the web search tool, returning
  3–4 grounded suggestions via a structured tool/`output_config.format` shape.
- Route handler `GET/POST /api/ai/discover` (server-only, AI-mode-gated) so the
  key never reaches the browser — mirrors the slice-0 ping route.

### 3. Assistant entry point — `src/components/assistant.tsx`

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

## Build slicing (validate each step)

The full vision is v1, but build it in validated sub-steps:

- **A — Preferences:** table + `/profile` editor + queries. Shippable alone.
- **B — Discovery loop:** `claude.ts` web search + `restaurant-discovery.ts` +
  `/api/ai/discover` + the Assistant affordance + cited results. The core.
- **C — Accept → event:** the Add-to-itinerary confirm wired to existing actions.
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
