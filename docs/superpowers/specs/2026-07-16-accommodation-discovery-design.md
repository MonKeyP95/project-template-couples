# Accommodation discovery (find a place to stay)

**Date:** 2026-07-16
**Status:** Approved, ready for plan
**Depends on:** the existing discovery door + seam (Food/Activities), profile-growth slice 3 (accommodation learns from real expenses).

## Problem

The assistant's find door can discover **Food** and **Activities** but not a place to **stay**. Accommodation already exists everywhere *except* discovery: it is an input category in the itinerary planner, a seeded budget category, and it already learns from real expenses on `/profile`. The door even carries a disabled `{ key: "stay", title: "Accommodation", soon: true }` placeholder (`find-a-place-planning.tsx`). This slice flips that placeholder live.

Transport is explicitly **not** in scope — it is a different shape (origin→destination routing, not a single web-searchable place) and gets its own later brainstorm. Its `soon:` placeholder stays.

## Goal

From the find door, a couple can search **places to stay** (area + price), get a real, cited shortlist, and add a pick to their itinerary as a normal event tagged `Accommodation` — reusing the whole existing commit path. Works identically in **planning** (add to a day of a chosen location) and **on the road** (add to today).

Non-goals (deferred): lodging structure — nights, check-in/out, multi-day spans (the deferred "richer itinerary structure" option); transport discovery; any new table or migration.

## The one divergence from Food/Activities

Food/activity search asks *"what do you feel like? / near… / walking distance."* Accommodation asks only **area + price**, and drops craving and walkable. The place itself is already known from door context (the location picker in planning, or where you are on the road) — it is not re-asked.

## Design

Three small touches; no schema, no migration, no new deps. An accommodation pick is a normal itinerary event, so budget + profile-learning need no change.

### 1. Category + seam (`src/lib/ai/discovery-types.ts`, `src/lib/ai/claude.ts`)

- `DiscoveryCategory` widens: `"food" | "activity" | "stay"`.
- `mapDiscoveryCategory("stay")` → `"Accommodation"` (the expense/event category name; already a real seeded category, understood by budget + learning).
- `discoverySystem` gains a `stay` branch: noun "places to stay"; same web-search discipline; the precedence line drops the walkable/craving framing and instead weights **area fit + price band**, then trip vibe, then learned-accommodation summary, then the taste dial.
- `discoveryPrompt` gains a `stay` branch: `Find places to stay in {destination}.` + area line (from `near`) + price band line (from `budgetBand`) + learned line + dial line + trip vibe/brief. No craving/walkable lines.

### 2. Query wiring (`src/app/api/ai/discover/route.ts`)

Reuse existing `DiscoveryQuery` fields — **no new fields on the type**:

- **area → `near`.** The section sends the typed area in the existing `near` field.
- **price → `budgetBand`.** The section sends a new `price` band in the request body; for `stay` the route uses `body.price` as `budgetBand` instead of the couple's dining `prefs.budgetBand`. (Food/activity keep sourcing `budgetBand` from dining prefs.)
- The route's category parse extends to accept `"stay"`.
- The learned summary fetch maps the discovery category to `LearnedCategory`: `stay` → `"accommodation"` when calling `getCoupleSummary`. (Food/activity map to their same-named `LearnedCategory` as today.)
- `walkable`/`craving` are simply absent from a stay request (default `false`/`""`).

Price band vocabulary reuses the existing dining bands for consistency: `any | budget | mid | splurge`.

### 3. Search inputs (`src/components/discovery-section.tsx`)

Today the input row hardcodes craving/near/walkable. Add one category branch:

- **`stay`** renders **area** (text, into `near`) + **price** (band chips, into a new `price` state sent in the request). No craving, no walkable checkbox.
- **`food`/`activity`** render the existing craving/near/walkable inputs unchanged.

One component, one `if` — mirrors how the seam already branches by category. Results list, the confirm-and-add affordance, day/date pickers, and the `commit → addTodayEvent` path are all reused untouched.

### 4. Door wiring (`src/app/trips/[slug]/find-a-place-planning.tsx` + the on-the-road door)

Flip the `stay` category from `soon: true` to a live `DiscoverySection`:

- `category="stay"`, `destination={place}`, `defaultNear=""` (area starts blank — the place is already the anchor), the same `addTarget` shape food/activity use (planning: select/create a day of the location; on the road: fixed to today).
- `buildEventText={(s) => `Stay · ${s.name}`}`.
- `ctaLabel` reuses the existing `add to {location}` / `add to a day` / `add today` label.
- Transport stays `soon: true`.

Both door surfaces (planning `PlanningPlaceDoor` and the on-the-road door) get the same live `stay` category.

## Modes (planning vs. on the road)

Same inputs (area + price) in both; only where the pick lands differs — and that is already handled by the existing `addTarget`:

- **Planning** — location picker chooses the place; the pick is added to a selected/created day of that location, tagged `Accommodation`.
- **On the road** — the place is where you are; the pick is added to today, tagged `Accommodation`. A real "find a place to stay tonight" use.

## What we are reusing (why this is small)

- Commit path (`DiscoverySection.commit → addTodayEvent`) — unchanged; accommodation is just another event category.
- Budget: `Accommodation` is an existing seeded category — a logged expense on this event already rolls up.
- Profile-learning: accommodation already learns from real `Accommodation` expenses (slice 3) — no change; discovery just makes those expenses easier to create.
- The whole results/confirm/add UI in `DiscoverySection`.

## Acceptance

- The find door shows **Accommodation** as a live (non-`soon`) category in both planning and on-the-road.
- Selecting it shows **area + price** inputs (no craving/walkable).
- `find` returns a real, cited shortlist of places to stay for the destination, biased by area + price band + trip vibe + learned-accommodation summary + taste dial.
- Adding a pick creates an itinerary event `Stay · {name}` tagged `Accommodation` on the right day (chosen day in planning, today on the road), with the source URL.
- Food/activity discovery is byte-for-byte unchanged.
- Transport remains `soon:`.
- No migration; `pnpm lint` + `pnpm build` clean.
