# Discovery per category — slice 5 design

**Date:** 2026-07-07
**Status:** design approved; plan next.
**Roadmap:** item 5 of the two-level-profile vision
(`docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`).
**Builds on:** slice 3 (the discovery engine + in-the-moment inputs), slice 4
(the profile category spine + the `ProfileCategory` accordion), slice 2 (couple
`activities`).

## Goal

Turn the single Food discovery door in each mode into **one four-section door**
whose sections mirror the profile spine — Food / Accommodation / Transport /
Activities. Generalize the discovery engine so a category drives the search.
This slice makes **Food** and **Activities** live; **Accommodation** and
**Transport** appear as visible but inactive ("coming soon") sections.

## Shape of the change

Two placements are unchanged (the two-modes principle): the **on-the-road page**
hosts the on-the-road door, the **trip page** hosts the planning door. Within
each, the current single Food search UI becomes a four-section accordion. Food
and Activities are live discovery sections; Accommodation and Transport are
inactive labelled sections.

The discovery mirror of the profile: profile has four "what we like" sections;
discovery has the same four "find one" sections.

## Scope

**In scope**
- Generalize the discovery engine to a category parameter (`food` | `activity`).
- Add `category` to the discover route (default `food`, back-compatible).
- Extract the shared search+results+add UI into one `DiscoverySection`
  component; both doors become four-section accordions using it.
- Relocate the `ProfileCategory` accordion to a shared path for reuse by the
  doors and the profile page.

**Out of scope (explicitly)**
- Meal granularity within Food (breakfast/lunch/dinner picker) — a later slice.
- Activating Accommodation / Transport discovery — they have no profile section
  yet; activating them would break the pairing rule. They ship inactive.
- The learning layer (ratings -> derived preferences).
- No new columns, migrations, or dependencies. No new AI provider surface —
  `lib/ai` stays the one seam, suggest-only.

**Pairing-rule note.** The rule is "a category's discovery door ships with its
profile section." Food's section shipped in slice 4; Activities' section shipped
in slice 2/4 but has had **no consumer** until now. This slice honors the rule's
intent — it gives the already-stored Activities preferences their first reader.
Accommodation/Transport stay inactive precisely because their sections do not
exist yet.

## Engine generalization (`src/lib/ai/claude.ts`)

The engine is already structurally general; only the noun, the tool name, and
one prompt line are Food-specific.

- Add `DiscoveryCategory = "food" | "activity"` and a `category` field on the
  query.
- `DISCOVERY_SYSTEM` is parameterized by category: "You help a couple find
  **restaurants** / **things to do** for a trip…". The rest of the system text
  (web_search required, propose 3-4, never invent, one-sentence why, the
  precedence rule craving > this trip > couple defaults, walkable as a hard
  constraint) is category-agnostic and unchanged.
- The structured-output tool is renamed `propose_restaurants` ->
  `propose_places` with an unchanged schema (`suggestions[]` of
  `name/why/area/priceHint/sourceUrl`). `priceHint` reads as "cost feel" and
  already fits an activity.
- `discoveryPrompt(query)` branches on category for the **opening line** and the
  **taste lines**:
  - Food (unchanged): "Find restaurants in {destination} for {when}." + budget,
    vibe, dietary, cuisines, activities, then the trip block.
  - Activity: "Find things to do in {destination}." (no meal `when`) + the
    couple's **activities** and general **vibe**, then the trip block. Drops the
    food-only lines (budget, cuisines, dietary).
  - Both keep the in-the-moment lines: craving, and the walkable/near anchor
    line, identically.
- `searchRestaurants(query)` becomes `discover(query)` returning the same
  suggestion array; it reads `category` to pick the system prompt and matches
  the `propose_places` tool.

## Types (`src/lib/ai/restaurant-discovery-types.ts` -> `discovery-types.ts`)

Rename the file and its types to drop the Food framing, since they now serve all
categories:
- `RestaurantQuery` -> `DiscoveryQuery`, plus a new
  `category: DiscoveryCategory` field.
- `RestaurantSuggestion` -> `DiscoverySuggestion` (fields unchanged).
- Export `DiscoveryCategory`.

Update the importers: `claude.ts`, `route.ts` (both types + engine), and the two
door components (`DiscoverySuggestion` type only — they follow the `*-types.ts`
client-import rule). Pure types, no `server-only`/SDK import, so client
components may import them.

## Route (`src/app/api/ai/discover/route.ts`)

- Read `category` from the body; default `"food"` so existing/older callers are
  unaffected.
- Build the `DiscoveryQuery` with that `category`; everything else is unchanged
  (loads `getDiningPreferences` + `getTripProfile`, populates craving/near/
  walkable from the body). Call `discover(query)`.

## `DiscoverySection` component (new, shared client component)

Extract the current Food door body (search inputs + fetch + results + add) into
one reusable client component so Food and Activities share it and the two modes
share it. Suggested path `src/app/trips/[slug]/discovery-section.tsx` or a shared
`src/components` path (plan decides).

Responsibilities (owned internally): the craving / near / walkable inputs, the
`find` button, the POST to `/api/ai/discover` (sending `category`, `destination`,
`when`, `tripId`, `craving`, `near`, `walkable`), loading/error state, the
results list (`name`, `why`, `area · priceHint`, source link), and the per-result
add affordance (added set, confirming, optional time).

Props (the mode/category context the door supplies):
- `category: DiscoveryCategory`, `tripId`, `tripSlug`, `destination`.
- `when: string` (meal for on-the-road Food; `"dinner"` for planning Food;
  unused/`""` for Activities).
- `defaultNear: string`, `defaultWalkable: boolean` (mode defaults preserved:
  on-the-road walkable on, planning off).
- Add target: either a fixed day `{ dayDate, dayId }` (on-the-road) or a list of
  selectable days `{ id, dayDate, label }[]` (planning). Exactly one is
  supplied.
- `buildEventText(s: DiscoverySuggestion): string` — Food/on-the-road:
  `"{mealLabel} · {name}"`; Food/planning: `"Dinner · {name}"`;
  Activity: `"{name}"`.

Add still goes through the existing `addTodayEvent` action; only the target-day
source and the event text differ, both supplied as props.

## The two doors become four-section accordions

Both doors keep their file location and their mode-specific setup (AI-mode gate,
meal/day derivation, `near` prefill, walkable default), but their body becomes a
four-section accordion built from the relocated accordion component:

- **on-the-road** (`src/app/on-the-road/find-a-place.tsx`): Food section
  (`when` = current meal, fixed today day, meal-label text, walkable default on),
  Activities section (same today anchor, name-only text, walkable default on),
  then inactive Accommodation / Transport.
- **planning** (`src/app/trips/[slug]/find-a-place-planning.tsx`): Food section
  (`when` = "dinner", day-select from the location's days, "Dinner ·" text,
  walkable default off), Activities section (same location days, name-only text,
  walkable default off), then inactive Accommodation / Transport.

Inactive sections render a muted "coming soon" line (no inputs), e.g.
Accommodation: "Coming soon — find a place to stay." Transport: "Coming soon —
find how to get around."

The on-the-road door currently hides itself once the meal is already planned;
with two live categories it should render whenever AI mode is on (Activities has
no meal-planned concept). The Food section keeps its own "already planned"
emptiness if that behavior is retained (plan decides the least-surprising rule).

## Accordion relocation

Move `ProfileCategory` from `src/app/profile/profile-category.tsx` to a shared
component path and a category-neutral name (e.g.
`src/components/category-section.tsx`, `CategorySection`). Update the profile
page import. Both doors and the profile page then use the one accordion
(title + optional hint + `defaultOpen` + children).

## Files

- **Modify** `src/lib/ai/claude.ts` — category-parameterized engine, renamed
  tool, `discover(query)`.
- **Rename** `src/lib/ai/restaurant-discovery-types.ts` ->
  `src/lib/ai/discovery-types.ts` — generalized types + `DiscoveryCategory`.
- **Modify** `src/app/api/ai/discover/route.ts` — read `category`.
- **Create** `DiscoverySection` client component.
- **Move/rename** the accordion to a shared `CategorySection`; update
  `src/app/profile/page.tsx`.
- **Modify** both doors into four-section accordions.

## Principles honored

- **Reuse, don't fork:** one engine, one suggestion shape, one accordion, one
  `DiscoverySection` across both categories and both modes.
- **Two modes:** on-the-road and planning each keep their own door and defaults.
- **YAGNI:** Accommodation/Transport are labels until their profile sections
  exist; no meal picker; no new storage.
- **Suggest-only, one AI seam:** all Claude calls stay in `lib/ai`; nothing
  writes autonomously.
