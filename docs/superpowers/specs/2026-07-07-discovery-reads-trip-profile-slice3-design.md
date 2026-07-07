# AI reads the trip profile + in-the-moment discovery — two-level profile slice 3

**Date:** 2026-07-07
**Status:** design agreed.
**Builds on:** slice A couple `dining_preferences`, slice 1 `trip_profile`
(`parseTripProfile`), slice 2 couple `activities`, and the restaurant discovery
engine (slices B1/B2/C/D). Roadmap item 3 of the two-level profile vision
(`docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`).

## Goal

Make restaurant discovery read the **trip profile** (the this-trip layer) and the
slice-2 couple **activities**, and add the two signals that matter most at search
time on the road: **what you feel like right now** and **can we actually walk
there**. Trip context and the in-the-moment inputs override the couple's general
defaults, arbitrated by the model via the prompt — no code-level field merge.

## Signal priority (highest first)

1. **Craving** — free-text "what do you feel like?" entered at search time.
2. **This trip** — the trip profile's vibe + brief.
3. **The couple generally** — budget, vibe, dietary, cuisines, activities.

**Walkability is a hard constraint**, not a ranked preference: when "on foot" is
set, only places within easy walking distance of the anchor qualify.

Precedence is expressed in the prompt + system instruction (the model arbitrates
conflicts like "adventurous trip" vs "quiet couple"); there is no merge logic in
code. Restaurants only — this slice does not add other discovery categories (see
the roadmap note below).

## Data model

No migration. Everything already exists: couple prefs on `dining_preferences`
(incl. `activities` from slice 2), the trip profile in `trips.trip_profile`
(jsonb, tolerant `parseTripProfile`).

New read: `getTripProfile(tripId: string): Promise<TripProfile>` in
`src/lib/trips/queries.ts` — RLS-scoped `select trip_profile from trips where id
= tripId`, returns `parseTripProfile(row?.trip_profile)` (empty profile when the
row is missing or the column is null). Small, single-purpose, mirrors the
existing `getDiningPreferences` shape.

## Types (`src/lib/ai/restaurant-discovery-types.ts`)

`RestaurantQuery` gains:

```ts
export interface RestaurantQuery {
  destination: string
  when: string
  budgetBand: string
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
  activities: string[]            // couple, slice 2
  trip: { vibe: string[]; brief: string }  // this-trip layer
  craving: string                 // in-the-moment; "" when unset
  near: string                    // proximity anchor; "" when unset
  walkable: boolean               // on-foot hard constraint
}
```

`RestaurantSuggestion` is unchanged.

## Route (`src/app/api/ai/discover/route.ts`)

Body type extends to `{ destination?, when?, tripId?, craving?, near?, walkable? }`.

- Keep the AI-mode 403 and the workspace 401.
- `destination` still required (400 otherwise).
- Load `prefs = getDiningPreferences(workspace.id)` (now includes `activities`).
- Load the trip profile: if `tripId` is present, `profile = await
  getTripProfile(tripId)` (RLS makes a foreign trip return the empty profile);
  if absent, use `EMPTY_TRIP_PROFILE`. `tripId` stays optional so the route never
  hard-fails on a door that doesn't send it.
- Build the query:

```ts
const query: RestaurantQuery = {
  destination,
  when: String(body.when ?? "soon").trim(),
  budgetBand: prefs.budgetBand,
  vibeTags: prefs.vibeTags,
  dietary: prefs.dietary,
  cuisines: prefs.cuisines,
  activities: prefs.activities,
  trip: { vibe: profile.vibe, brief: profile.brief },
  craving: String(body.craving ?? "").trim(),
  near: String(body.near ?? "").trim(),
  walkable: Boolean(body.walkable),
}
```

Server-authoritative for profile data (as with prefs); the door supplies only the
in-the-moment inputs + `tripId`.

## Prompt + system (`src/lib/ai/claude.ts`)

`discoveryPrompt(query)` renders, in order:

1. Lead: `Find restaurants in ${destination} for ${when}.`
2. Craving (if set): `Right now they are in the mood for: ${craving}.`
3. Proximity (if `near` set): when `walkable`, `They are on foot — only suggest
   places within easy walking distance of ${near}.`; else `Prefer places near
   ${near}.` (If `near` is empty but `walkable` is true, fall back to
   `${destination}` as the anchor.)
4. "The couple generally" block: budget band + the `vibeTags` / `dietary` /
   `cuisines` / `activities` lists (each omitted when empty), using the existing
   `list(label, items)` helper.
5. "This trip" block: `trip.vibe` list (labelled "This trip's vibe") + the
   `trip.brief` sentence (when non-empty).

`DISCOVERY_SYSTEM` gains two sentences: a priority-ordering rule ("Weight what
they're in the mood for right now first, then this trip's vibe and brief, then
the couple's general tastes") and a strict-walkability rule ("If told they are on
foot, only propose places genuinely within walking distance of the given anchor;
never suggest somewhere that needs a car or a long ride").

## Doors (both gain three optional in-the-moment inputs)

Untouched inputs keep today's zero-effort behavior. New per-door state:
`craving` (text), `near` (text), `walkable` (toggle); all sent in the POST body
alongside `tripId`.

**On-the-road** (`src/app/on-the-road/find-a-place.tsx`): `near` prefills the
`destination` prop; **walkable defaults `true`** (on the road you're on foot). The
meal inference for `when` is unchanged. Inputs sit above the existing "find
{meal}" button.

**Planning** (`src/app/trips/[slug]/find-a-place-planning.tsx`): `near` prefills
the selected `location.name` and **resets when the location select changes**;
**walkable defaults `false`** (planning is not on-foot yet). Inputs sit in the
control row before "find dinner". `when` stays "dinner" (the meal picker is a
later slice).

Both doors already have `tripId` in scope; the only body change is the added
fields.

## Two modes

- **On the road:** craving + walkable are the potent signals — you're standing
  somewhere hungry; walkable defaults on, `near` = where you are.
- **Planning:** craving is optional forethought ("we'll want seafood one night"),
  walkable defaults off, `near` = the location you're staging.

Same engine, same route; the doors set mode-appropriate defaults.

## Scope guards / deferred

- No migration, no new deps, no new vendor (proximity is text the model searches
  on, not a geo radius — a maps API is explicitly out).
- `lib/ai` stays the one seam; suggest-only (nothing under `lib/ai` writes).
- **Deferred:** past ratings into ranking (slice 4, the learning layer);
  who/headline signals; a meal picker; discovery for other categories.

## Roadmap note (record when this spec lands)

Two items to append to the two-level-profile roadmap
(`docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`):

- **Next slice — couple profile organized into categories.** Split the couple
  profile page into sections on the app's category spine (Food / Accommodation /
  Transport / Activities). Populate **Food** (the existing dining prefs) and
  **Activities** (slice 2) now; Accommodation/Transport are labelled homes left
  empty until a consumer exists. Presentational IA; no speculative capture.
- **Vision — discovery per category.** The unifying pattern: each category has a
  profile section (what we like) + a discovery door (find one), reading the same
  trip profile + in-the-moment inputs. Restaurant discovery is the Food instance.
  Expansion runs on two axes: meal granularity within Food (breakfast/lunch/
  dinner picker), and new category doors (Accommodation/Transport/Activities) —
  **each category's profile section ships in the same slice as its discovery
  door**, so no preference is stored ahead of the thing that reads it.
