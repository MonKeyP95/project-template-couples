# Discovery Category On The Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A discovery-added itinerary event remembers whether it was food or an activity, so its expense form defaults the category to `Food` / `Activities` instead of always `Other`.

**Architecture:** Add an optional `category?: string` to `ItineraryEvent` riding in the existing `events` jsonb (no migration). The discovery door stamps it at add time; the write path preserves it; the event's expense form reads it back and pre-selects it when the trip still has a category by that name, else falls back to `Other`.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Tailwind v4. Verification is `pnpm lint` + `pnpm build` (no test framework in this repo).

## Global Constraints

- No emojis in code, comments, or copy.
- No new dependency, no migration.
- `category` is invisible metadata: no visual change to the event. Only `EventExpense`'s default category changes.
- Only discovery-added picks carry a category. Manually-typed events have no `category` and default to `Other`, exactly as today.
- Mapping is exactly `food -> "Food"`, `activity -> "Activities"`.
- Resolution is graceful: `EventExpense` pre-selects the event's category only if a trip category with that exact name exists; otherwise `Other`; otherwise `""`.
- Preserve the optional-field spread pattern already used for `url`/`rating`/`note` in `parseEvents` and `normalizeDayEvents` (omit the key when the value is absent/empty; never write `category: undefined` or `category: ""`).
- Verify each task with `pnpm lint` then `pnpm build`; both must be clean before commit. If `pnpm build` fails with a Windows Turbopack subprocess panic (exit 0xc0000142 / spawn error), that is an environment flake: stop, delete `.next/`, retry once.

---

### Task 1: Event carries a category (data + write path + discovery stamp)

Add the field to the type, preserve it through the shared read and write paths, add the mapping helper, and stamp it from the discovery door. After this task the event stores its category; nothing consumes it yet (verified by build).

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`
- Modify: `src/lib/trips/actions.ts`
- Modify: `src/lib/ai/discovery-types.ts`
- Modify: `src/components/discovery-section.tsx`

**Interfaces:**
- Consumes: `DiscoveryCategory` (`"food" | "activity"`) from `@/lib/ai/discovery-types`.
- Produces:
  - `ItineraryEvent.category?: string`
  - `mapDiscoveryCategory(category: DiscoveryCategory): string` in `@/lib/ai/discovery-types`
  - `AddTodayEventInput.category?: string`

- [ ] **Step 1: Add `category` to `ItineraryEvent`**

In `src/lib/trips/itinerary-types.ts`, add the field to the interface (after `note`):

```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  /** Optional "HH:MM"-style end label. Omitted when absent. Cosmetic. */
  endTime?: string
  text: string
  /** Optional source/booking link. Omitted when absent. */
  url?: string
  /** Optional 1-5 rating. Omitted when unrated. */
  rating?: number
  /** Optional free note captured with a rating. Omitted when empty. */
  note?: string
  /** Optional expense category tag from the discovery door (e.g. "Food"). Drives
   * the default in the event's expense form; omitted when absent. */
  category?: string
}
```

- [ ] **Step 2: Read `category` back in `parseEvents`**

In the same file, add a `category` spread to the mapped object inside `parseEvents`, after the `note` spread:

```ts
      ...(typeof e.note === "string" && e.note.length > 0 ? { note: e.note } : {}),
      ...(typeof e.category === "string" && e.category.length > 0
        ? { category: e.category }
        : {}),
```

- [ ] **Step 3: Preserve `category` in `normalizeDayEvents`**

In `src/lib/trips/actions.ts`, in `normalizeDayEvents`, add a `category` spread after the `note` spread:

```ts
      ...(typeof e.note === "string" && e.note.trim() ? { note: e.note.trim() } : {}),
      ...(typeof e.category === "string" && e.category.trim()
        ? { category: e.category.trim() }
        : {}),
```

- [ ] **Step 4: Add `category` to `AddTodayEventInput` and `addTodayEvent`'s `newEvent`**

In `src/lib/trips/actions.ts`, add the optional field to `AddTodayEventInput` (after `url`):

```ts
  /** Optional source/booking link stored on the event. */
  url?: string
  /** Optional expense category tag from the discovery door. */
  category?: string
```

Then in `addTodayEvent`, carry it onto `newEvent`. Change:

```ts
  const url = (input.url ?? "").trim()
  const newEvent: ItineraryEvent = { time: input.time.trim(), text, ...(url ? { url } : {}) }
```

to:

```ts
  const url = (input.url ?? "").trim()
  const category = (input.category ?? "").trim()
  const newEvent: ItineraryEvent = {
    time: input.time.trim(),
    text,
    ...(url ? { url } : {}),
    ...(category ? { category } : {}),
  }
```

(Both the append and create-day branches use this same `newEvent`, so both carry the category.)

- [ ] **Step 5: Add `mapDiscoveryCategory` helper**

In `src/lib/ai/discovery-types.ts`, add after the `DiscoveryCategory` type:

```ts
/** The expense category an event gets when added from the discovery door.
 * Resolved against the trip's real categories at expense time; falls back to
 * Other when the trip has no category by this name. */
export function mapDiscoveryCategory(category: DiscoveryCategory): string {
  return category === "food" ? "Food" : "Activities"
}
```

- [ ] **Step 6: Stamp the category from the discovery door**

In `src/components/discovery-section.tsx`, import the helper — change:

```ts
import type {
  DiscoveryCategory,
  DiscoverySuggestion,
} from "@/lib/ai/discovery-types"
```

to:

```ts
import {
  mapDiscoveryCategory,
  type DiscoveryCategory,
  type DiscoverySuggestion,
} from "@/lib/ai/discovery-types"
```

Then in `commit()`, add `category` to the `addTodayEvent` call (after `url: s.sourceUrl,`):

```ts
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: normalizeTime(time),
      text: buildEventText(s),
      url: s.sourceUrl,
      category: mapDiscoveryCategory(category),
      locationId,
      dayTitle,
    }).then((result) => {
```

- [ ] **Step 7: Verify lint and build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (Compiled successfully).

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/actions.ts src/lib/ai/discovery-types.ts src/components/discovery-section.tsx
git commit -m "feat(itinerary): stamp discovery picks with an expense category"
```

---

### Task 2: Expense form defaults to the event's category

Read the stamped category back in `EventExpense` and use it as the default, resolved against the trip's categories; thread the event's category in from `itinerary-tab.tsx`.

**Files:**
- Modify: `src/app/trips/[slug]/event-expense.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: `ItineraryEvent.category?: string` (Task 1); `EventExpenseProps`.
- Produces: `EventExpenseProps.eventCategory?: string`.

- [ ] **Step 1: Add `eventCategory` to `EventExpenseProps`**

In `src/app/trips/[slug]/event-expense.tsx`, add to the props interface (after `eventText`):

```ts
  /** Expense title; the event's own text. */
  eventText: string
  /** Optional category stamped on the event by the discovery door; used as the
   * default expense category when the trip still has a category by this name. */
  eventCategory?: string
```

- [ ] **Step 2: Accept the prop and default the category to it**

In the same file, add `eventCategory` to the destructured params (after `eventText,`):

```ts
  tripId,
  tripSlug,
  eventText,
  eventCategory,
  dayDate,
```

Then change the category state initialiser. Replace:

```ts
  // Default to "Other" when the trip has it (it is seeded by default); the
  // field stays editable and still resolves to "Other" if cleared.
  const [category, setCategory] = React.useState(
    categories.find((c) => c.name === "Other")?.name ?? "",
  )
```

with:

```ts
  // Default to the event's stamped category when the trip still has one by that
  // name (discovery picks), else "Other" (seeded by default); the field stays
  // editable and still resolves to "Other" if cleared.
  const [category, setCategory] = React.useState(
    (eventCategory && categories.find((c) => c.name === eventCategory)?.name) ??
      categories.find((c) => c.name === "Other")?.name ??
      "",
  )
```

- [ ] **Step 3: Thread the event's category in from `itinerary-tab.tsx`**

In `src/app/trips/[slug]/itinerary-tab.tsx`, at the `<EventExpense>` usage (around line 1404), add one prop after `eventText={ev.text}`:

```tsx
                    <EventExpense
                      tripId={tripId}
                      tripSlug={tripSlug}
                      eventText={ev.text}
                      eventCategory={ev.category}
                      dayDate={day.dayDate}
                      locationId={day.locationId}
                      currentUserId={currentUserId}
```

(Only the `eventCategory={ev.category}` line is new; the surrounding lines are shown for placement. `ev` is the `ItineraryEvent` already in scope at this call site.)

- [ ] **Step 4: Verify lint and build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (Compiled successfully).

- [ ] **Step 5: In-app check**

Run: `pnpm dev`. On a trip, open the assistant's find-a-place door, run a Food search, and add a pick to a day. Then press that event in the itinerary and open its expense form.
Expected:
- The category dropdown defaults to **Food** (not Other).
- Repeat with an Activities search -> defaults to **Activities** (if the trip has that category; else Other).
- A manually-typed event still defaults to **Other**.
- The event's appearance in the itinerary is unchanged (no visible category tag).

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/event-expense.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): event expense defaults to the discovery category"
```

---

### Task 3: Update docs

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Record the slice**

Add a checked entry near the top of the completed-task log in `docs/TODO.md` summarizing: discovery-added events now carry an optional `category` in the `events` jsonb (`food -> "Food"`, `activity -> "Activities"` via `mapDiscoveryCategory`), preserved through `normalizeDayEvents`/`parseEvents` and `addTodayEvent`; `EventExpense` defaults its category to the event's stamped one when the trip still has a category by that name, else `Other`. Invisible on the event; manually-typed events unchanged; no migration/deps. This completes the follow-up slice flagged on the event-expense feature. Reference spec `docs/superpowers/specs/2026-07-13-event-category-design.md` and plan `docs/superpowers/plans/2026-07-13-event-category.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: record discovery-category-on-event slice"
```

---

## Self-Review

- **Spec coverage:** `ItineraryEvent.category` (T1 S1), `parseEvents` read-back (T1 S2), `normalizeDayEvents` passthrough — the drop point (T1 S3), `AddTodayEventInput` + `addTodayEvent` (T1 S4), `mapDiscoveryCategory` (T1 S5), discovery stamp in both doors via shared `DiscoverySection` (T1 S6), `EventExpense` default with graceful fallback (T2 S1-2), one-line thread in `itinerary-tab.tsx` (T2 S3). Share-page parser intentionally untouched (spec Out of scope) — no task, correct. All spec sections map to a task.
- **Placeholder scan:** No TBD/TODO-in-code; every code step shows full before/after.
- **Type consistency:** `category?: string` used consistently across `ItineraryEvent`, `AddTodayEventInput`, and `EventExpenseProps.eventCategory`. `mapDiscoveryCategory(category: DiscoveryCategory): string` defined in T1 S5, consumed in T1 S6. The `EventExpense` initialiser uses `categories.find((c) => c.name === eventCategory)?.name` matching the existing `ExpenseCategoryRow.name` shape.
