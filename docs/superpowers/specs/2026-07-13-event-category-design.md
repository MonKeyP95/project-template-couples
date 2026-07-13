# Carry discovery category onto the event — design

Date: 2026-07-13

## Problem

When the assistant's find-a-place door (Food / Activities) adds a pick as an
itinerary event, the event carries no category. Later, pressing that event to log
an expense (`EventExpense`) always defaults the expense category to **Other**, even
though the door already knew the pick was food or an activity. The user has to
re-pick the category every time.

## Goal

A discovery-added event remembers whether it was **food** or an **activity**, and
the event's expense form defaults its category accordingly (`Food` / `Activities`)
instead of always `Other`. The category is **invisible metadata** — the event looks
exactly as it does today; the only visible effect is the pre-selected category in
the expense form.

## Approach

Add an optional `category?: string` to `ItineraryEvent`, riding in the existing
`events` jsonb (like `url` / `rating` / `note` already do) — **no migration**. The
discovery door stamps it at add time; the event's expense form reads it back and
uses it as the default, resolved against the trip's real `expense_categories`.

## Decisions

- **Invisible metadata.** No new visual on the event. The category only changes the
  default in `EventExpense`.
- **Only discovery-added picks carry a category.** Manually-typed events have no
  category and default to `Other`, exactly as today.
- **Mapping:** `food -> "Food"`, `activity -> "Activities"` (both are in the default
  seeded category set).
- **Graceful fallback at expense time.** The stamped category is a plain string.
  `EventExpense` pre-selects it only if a category with that name still exists on the
  trip; otherwise it falls back to `Other`. A trip that renamed or deleted the
  category (or an older trip seeded before `Activities` existed) just falls back — no
  error, no broken state.

## Changes

### 1. `src/lib/trips/itinerary-types.ts`

- Add `category?: string` to `ItineraryEvent` (documented as "optional expense
  category tag from the discovery door; omitted when absent").
- In `parseEvents`, read it back tolerantly: include `category` only when it is a
  non-empty string (same spread pattern as `url` / `note`).

### 2. `src/lib/trips/actions.ts`

- **`normalizeDayEvents`** — add a `category` passthrough in the mapped object,
  alongside the existing optional-field spreads:
  `...(typeof e.category === "string" && e.category.trim() ? { category: e.category.trim() } : {})`.
  This is the one place a save would otherwise silently drop the field; every
  itinerary write path runs through it.
- **`AddTodayEventInput`** — add optional `category?: string`.
- **`addTodayEvent`** — carry it onto the constructed `newEvent`:
  `...(input.category?.trim() ? { category: input.category.trim() } : {})`.
  This flows through both the append-to-existing-day and create-new-day branches,
  because both use the same `newEvent`.

### 3. `src/lib/ai/discovery-types.ts`

- Add a pure helper:
  ```ts
  /** The expense category an event gets when added from the discovery door.
   * Resolved against the trip's real categories at expense time; falls back to
   * Other when the trip has no category by this name. */
  export function mapDiscoveryCategory(category: DiscoveryCategory): string {
    return category === "food" ? "Food" : "Activities"
  }
  ```

### 4. `src/components/discovery-section.tsx`

- In `commit()`, pass `category: mapDiscoveryCategory(category)` into the
  `addTodayEvent` call. Both the planning door (`find-a-place-planning.tsx`) and the
  on-the-road door (`find-a-place.tsx`) share this component, so both get it with no
  further change.

### 5. `src/app/trips/[slug]/event-expense.tsx`

- Add optional prop `eventCategory?: string`.
- Change the category state initialiser from "Other or empty" to "the event's
  category if it exists on the trip, else Other, else empty":
  ```ts
  const [category, setCategory] = React.useState(
    (eventCategory && categories.find((c) => c.name === eventCategory)?.name) ??
      categories.find((c) => c.name === "Other")?.name ??
      "",
  )
  ```
- `itinerary-tab.tsx` renders `EventExpense` (around line 1404) with the event
  object `ev` already in local scope (it passes `eventText={ev.text}`). Add one
  line there: `eventCategory={ev.category}`. No deep prop threading is needed.

## Out of scope

- No migration, no new dependency.
- No change to the event's appearance (no category chip/tag).
- The public share page parser (`shared-trip-types.ts`) is not touched — it logs no
  expenses, so it has no use for the field; unknown jsonb keys are ignored there.
- No mapping for categories other than food/activity (those are the only live
  `DiscoveryCategory` values).
- No back-filling of existing events (they simply keep defaulting to Other).

## Files

- `src/lib/trips/itinerary-types.ts` — `ItineraryEvent.category`, `parseEvents`.
- `src/lib/trips/actions.ts` — `normalizeDayEvents`, `AddTodayEventInput`, `addTodayEvent`.
- `src/lib/ai/discovery-types.ts` — `mapDiscoveryCategory`.
- `src/components/discovery-section.tsx` — stamp at `commit()`.
- `src/app/trips/[slug]/event-expense.tsx` — `eventCategory` prop + default.
- `src/app/trips/[slug]/itinerary-tab.tsx` — one line: `eventCategory={ev.category}`
  on the existing `<EventExpense>`.

No migration. Build + lint must stay clean.
