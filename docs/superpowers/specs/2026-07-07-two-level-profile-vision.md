# Two-level profile — vision & roadmap

**Date:** 2026-07-07
**Status:** vision agreed; slice 1 to be specced next.
**Supersedes:** the paused "Idea — per-trip profile" in `docs/TODO.md`
(2026-06-29) — this resolves its open fork (2): the trip profile **replaces**
the Notes tab (merged), rather than sitting beside `trip_notes`.
**Builds on:** Slice A couple `dining_preferences` (`/profile`), Slice D event
`rating`/`note` taste signal.

## Vision

Two profile layers the AI reads together:

- **Couple profile** — workspace-level, durable. "Who this couple is." A
  **manual base** (dining preferences + activities) that a **visible learned
  layer** enriches over time from accumulated ratings. Lives on the existing
  **`/profile` page, promoted into the nav**.
- **Trip profile** — per-trip, narrower. "What this trip is." The trip's **Notes
  tab becomes a "Profile" tab**: a headline + a few structured chips + a free
  brief, with the existing **notes as a section below**.

The couple layer is the accumulator (durable taste, enriched by ratings across
trips); the trip layer is transient per-trip intent. When they conflict at
recommendation time, **trip context wins** (this trip's "splurge/adventurous"
overrides the couple's general defaults).

## Level 1 — Couple profile (`/profile`, in nav)

- **Manual base:** the existing `dining_preferences` (budget band, vibe,
  dietary, cuisines) **plus activities** the couple generally enjoys.
- **Visible learned layer (deferred — slice 4):** the app periodically turns
  Slice D ratings into readable, **editable** learned preferences ("you rate
  quiet, local seafood spots highest"); the couple can confirm, tweak, or
  dismiss each. Stored as derived preferences, shown alongside the manual base.
- **Home:** `/profile` today holds dining preferences + AI toggle + display
  name; it becomes the couple profile page and gains a nav destination.

## Level 2 — Trip profile (the trip "Profile" tab)

Replaces the Notes tab. Contents, top to bottom:

- **Headline** — one short line capturing the trip's essence
  ("Surfing trip · 2 weeks"). Doubles as a human-readable trip subtitle.
- **Activities** chip — multi-pick (surf, hike, dive, eat, museums, beach,
  nightlife, …).
- **Vibe** chip — multi-pick (romantic, adventurous, chill, cultural, …).
- **Who's coming** chip — just us / + kids / + friends / + family.
- **Free brief** — a paragraph for whatever the chips don't capture.
- **Notes** — the existing per-trip notes feature, unchanged, as a section
  below.

Dropped from an earlier draft: occasion, pace, budget chips. Headline +
activities carry most of what occasion/pace conveyed; budget stays couple-level.

## AI consumption

Discovery (`searchRestaurants`) already merges the couple `dining_preferences`.
The trip profile adds the this-trip layer (activities/vibe/who/brief), and — once
the learned layer exists — the derived preferences bias ranking. Trip context
overrides couple defaults on conflict.

## Roadmap (build order — each a working increment)

1. **Trip Profile tab** (manual). Notes → Profile: per-trip profile data
   (headline, chips, brief) + the existing notes below. Self-contained.
2. **Couple profile in nav** (manual). Promote `/profile` into the nav; add
   activities to the existing dining preferences.
3. **AI reads the trip profile + in-the-moment discovery** (2026-07-07 spec).
   Feed the trip's vibe + brief and the slice-2 couple activities into restaurant
   discovery, and add the two signals that matter most on the road: a free-text
   **craving** ("what do you feel like?") and a **walkable-from-anchor** proximity
   constraint (`near` prefilled + on-foot toggle). Priority: craving > this trip >
   couple defaults; walkability is a hard constraint. Prompt-level precedence, no
   code merge. Spec: `docs/superpowers/specs/2026-07-07-discovery-reads-trip-profile-slice3-design.md`.
4. **Couple profile organized into categories** (presentational IA). Split the
   couple profile page onto the app's category spine — Food / Accommodation /
   Transport / Activities. Populate **Food** (existing dining prefs) and
   **Activities** (slice 2) now; Accommodation/Transport are labelled homes left
   empty until a consumer exists. No speculative capture — a section is built when
   something reads it.
5. **Discovery per category** (vision). The unifying pattern: each category has a
   profile section (what we like) + a discovery door (find one), reading the same
   trip profile + in-the-moment inputs. Restaurant discovery is the **Food**
   instance. Two expansion axes: meal granularity within Food (breakfast/lunch/
   dinner picker), and new category doors (Accommodation / Transport / Activities).
   Rule: **each category's profile section ships in the same slice as its
   discovery door**, so no preference is stored ahead of the thing that reads it.
6. **Learning layer (later).** Derive the visible learned preferences from
   ratings, show them editable in the couple profile, and feed them into
   discovery ranking. The payoff; deferred until enough ratings accumulate.

## Open per-slice (resolved in each slice's own spec)

- Slice 1: exact chip tag sets; trip-profile data model (jsonb column on `trips`
  vs discrete columns vs a `trip_profiles` table); Profile-tab layout; whether
  the headline also surfaces as a trip subtitle elsewhere.
- Slice 2: nav placement/order; how activities are modelled alongside
  `dining_preferences`; what stays "account settings" vs "couple taste".
- Slice 4: derived-preference storage; the summarization trigger (on-demand vs
  scheduled); confirm/dismiss UX; ranking integration.

## Principles honored

- **Two modes:** the trip profile is planning-facing (set before/early); the
  couple profile is always-on; both feed on-the-road and planning recs.
- **Cheapest first:** manual layers ship before the learning layer; reuse
  `dining_preferences`, `trip_notes`, and the `lib/ai` seam.
- **Suggest-only:** profiles inform recommendations; nothing under `lib/ai`
  writes autonomously.
