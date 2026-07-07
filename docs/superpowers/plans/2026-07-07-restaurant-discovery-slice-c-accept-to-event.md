# Restaurant Discovery Slice C — Accept-to-Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an accepted restaurant pick a real, keep-worthy itinerary event — carrying its source link and an optional date/time — and make that link a plain, hand-editable itinerary capability.

**Architecture:** Extend the `jsonb`-backed itinerary event with an optional `url` (no migration). Surface it in the normal day editor and on day cards. Change both discovery doors' "accept" from immediate to a small inline confirm (optional time; mode-aware date) that writes the link onto the event via the existing `addTodayEvent` action.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (jsonb column, no ORM), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-07-restaurant-discovery-slice-c-accept-to-event-design.md`

## Global Constraints

- **No migration.** `itinerary_days.events` is `jsonb`; the new `url` is a code-only field. Do not write SQL.
- **`url` is optional and omitted when empty.** Never store `url: ""` — include the key only when the trimmed value is non-empty. Readers add `url` only when it is a non-empty string.
- **No URL validation/normalization.** Store the string as-is; render as a link only when present.
- **Two modes.** On the road: date fixed to today. Planning: date is a picker of the browsed location's existing days (default earliest) — never a free date (a free date with no matching day creates a location-less day).
- **No test framework exists.** Verification per task is `npx tsc --noEmit` + `pnpm lint`, plus a manual phone-viewport (390px) check for UI tasks. Do not invent a test command.
- **European date order** in any human date label (`en-GB`, `{day} {mon}`) — reuse existing `ItineraryDay` fields, don't format afresh.
- **Commits:** the user commits only when they ask. Treat each "Commit" step as an optional checkpoint — batch and defer to the user's direction; never push.
- **No emojis in code/logs.** (The `↗` and `×` glyphs in JSX text are UI content, not emojis — they match existing usage.)

---

### Task 1: Event model — optional `url`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (interface `ItineraryEvent`, function `parseEvents`)

**Interfaces:**
- Produces: `ItineraryEvent` = `{ time: string; text: string; url?: string }`. `parseEvents(raw)` reads `url` only when it is a non-empty string.

- [ ] **Step 1: Add `url?` to the interface**

Change:
```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  text: string
}
```
to:
```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  text: string
  /** Optional source/booking link. Omitted when absent. */
  url?: string
}
```

- [ ] **Step 2: Read `url` in `parseEvents`**

Change the `.map(...)` in `parseEvents`:
```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
    }))
```
to:
```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
    }))
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (existing `{ time, text }` sites still satisfy the type — `url` is optional).

- [ ] **Step 4: Commit** (only if the user has asked to commit)

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): optional url on events (slice C)"
```

---

### Task 2: `addTodayEvent` threads `url`

**Files:**
- Modify: `src/lib/trips/actions.ts` (`AddTodayEventInput` type, `addTodayEvent` body)

**Interfaces:**
- Consumes: `ItineraryEvent.url?` (Task 1).
- Produces: `addTodayEvent(input)` accepts optional `input.url`; the event it writes carries `url` when non-empty.

- [ ] **Step 1: Add optional `url` to the input type**

Find the `AddTodayEventInput` interface (near the top of the file's itinerary-event section — it has `tripId`, `tripSlug`, `dayDate`, `dayId`, `time`, `text`). Add:
```ts
  /** Optional source/booking link stored on the event. */
  url?: string
```

- [ ] **Step 2: Build the event with the link**

Change:
```ts
  const newEvent: ItineraryEvent = { time: input.time.trim(), text }
```
to:
```ts
  const url = (input.url ?? "").trim()
  const newEvent: ItineraryEvent = { time: input.time.trim(), text, ...(url ? { url } : {}) }
```

- [ ] **Step 3: Preserve `url` when merging into an existing day**

The existing-day branch re-maps events and currently drops any extra keys:
```ts
    const events = [...existing, newEvent]
      .map((e) => ({ time: (e.time ?? "").trim(), text: (e.text ?? "").trim() }))
      .filter((e) => e.text.length > 0)
      .sort(sortDayEvents)
```
Change the `.map(...)` to carry `url`:
```ts
    const events = [...existing, newEvent]
      .map((e) => ({
        time: (e.time ?? "").trim(),
        text: (e.text ?? "").trim(),
        ...(typeof e.url === "string" && e.url.trim() ? { url: e.url.trim() } : {}),
      }))
      .filter((e) => e.text.length > 0)
      .sort(sortDayEvents)
```

(The new-day `insert` branch already writes `events: [newEvent]`, so it carries `url` with no change.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit** (only if the user has asked to commit)

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): addTodayEvent carries optional url (slice C)"
```

---

### Task 3: Hand-editable link in the day editor + day-card render

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`EventDraft`, `newEventDraft`, `toEventDrafts`, `DayView` event render, `DayForm` event rows, the two `events.map(...)` submit sites in `DayEditor` and `DayCreator`)

**Interfaces:**
- Consumes: `ItineraryEvent.url?` (Task 1). Editor drafts round-trip `url` through `addItineraryDay` / `updateItineraryDay`, which already accept `events: ItineraryEvent[]` (no action change).

- [ ] **Step 1: Add `url` to the draft type and factory**

Change:
```ts
interface EventDraft {
  key: string
  time: string
  text: string
}

function newEventDraft(time = "", text = ""): EventDraft {
  return { key: crypto.randomUUID(), time, text }
}
```
to:
```ts
interface EventDraft {
  key: string
  time: string
  text: string
  url: string
}

function newEventDraft(time = "", text = "", url = ""): EventDraft {
  return { key: crypto.randomUUID(), time, text, url }
}
```

- [ ] **Step 2: Carry `url` into drafts from stored events**

Change:
```ts
function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => newEventDraft(e.time, e.text))
}
```
to:
```ts
function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => newEventDraft(e.time, e.text, e.url ?? ""))
}
```

- [ ] **Step 3: Render the link on the day card (`DayView`)**

In the expanded-events block, change:
```tsx
                  {ev.time ? (
                    <span className="t-num shrink-0 text-foreground/70">
                      {ev.time}
                    </span>
                  ) : null}
                  <span>{ev.text}</span>
```
to:
```tsx
                  {ev.time ? (
                    <span className="t-num shrink-0 text-foreground/70">
                      {ev.time}
                    </span>
                  ) : null}
                  <span>{ev.text}</span>
                  {ev.url ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                    >
                      ↗ source
                    </a>
                  ) : null}
```

- [ ] **Step 4: Add a link input to each `DayForm` event row**

Wrap the existing event row (the `<div key={ev.key} className="flex items-center gap-2">…</div>` containing the time input, text input, and remove button) in a vertical stack and add a link input below it. Change the outer element from:
```tsx
          {events.map((ev) => (
            <div key={ev.key} className="flex items-center gap-2">
```
to:
```tsx
          {events.map((ev) => (
            <div key={ev.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
```
Then, immediately after the remove `<button>…×…</button>` that closes the row, close the inner flex div and add the link input before closing the outer div:
```tsx
                ×
              </button>
              </div>
              <input
                type="text"
                value={ev.url}
                onChange={(e) =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, url: e.target.value } : x,
                    ),
                  )
                }
                placeholder="link (optional)"
                disabled={isPending}
                className="w-full border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </div>
          ))}
```
(Net effect: the old single `</div>` after the remove button becomes `</div></div>` with the link input in between; indentation is cosmetic.)

- [ ] **Step 5: Submit `url` from both editor forms**

There are two identical submit maps — one in `DayEditor`, one in `DayCreator`. Change both occurrences of:
```ts
        events: events.map((e) => ({ time: e.time, text: e.text })),
```
to:
```ts
        events: events.map((e) => ({
          time: e.time,
          text: e.text,
          ...(e.url.trim() ? { url: e.url.trim() } : {}),
        })),
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Manual check (390px viewport)**

Run `pnpm dev`, open a dated trip's Itinerary tab. Edit a day → each event row shows a "link (optional)" input; add `https://example.com`, save. The day card shows `↗ source` after that event's text; the link opens in a new tab. Reload → link persists. Clearing the link and saving removes `↗ source`.

- [ ] **Step 8: Commit** (only if the user has asked to commit)

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): hand-editable event link + day-card render (slice C)"
```

---

### Task 4: On-the-road door — inline time confirm + link

**Files:**
- Modify: `src/app/on-the-road/find-a-place.tsx`

**Interfaces:**
- Consumes: `addTodayEvent` with optional `url` (Task 2). Passes `url: s.sourceUrl` and the entered `time`; date stays today.

- [ ] **Step 1: Add confirm + time state**

After the `added` state line (`const [added, setAdded] = React.useState<Set<string>>(new Set())`), add:
```tsx
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [time, setTime] = React.useState("")
```

- [ ] **Step 2: Replace `addToToday` with a `commit` that carries time + url**

Change:
```tsx
  function addToToday(s: RestaurantSuggestion) {
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: "",
      text: `${label} · ${s.name}`,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      router.refresh()
    })
  }
```
to:
```tsx
  function commit(s: RestaurantSuggestion) {
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: time.trim(),
      text: `${label} · ${s.name}`,
      url: s.sourceUrl,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      setConfirmingName(null)
      setTime("")
      router.refresh()
    })
  }
```

- [ ] **Step 3: Replace the per-suggestion button with a confirm-aware block**

Change:
```tsx
              <button
                type="button"
                onClick={() => addToToday(s)}
                disabled={added.has(s.name)}
                className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {added.has(s.name) ? "added" : "add to today"}
              </button>
```
to:
```tsx
              {added.has(s.name) ? (
                <span className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                  added
                </span>
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="19:30"
                    className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commit(s)}
                    className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                  >
                    add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingName(null)
                      setTime("")
                    }}
                    aria-label="Cancel"
                    className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingName(s.name)
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add to today
                </button>
              )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 5: Manual check (390px viewport, active trip, AI on)**

On `/on-the-road`, tap `find <meal>` → tap `add to today` on a pick → a time field + `add`/`×` appears. Type `19:30`, tap `add`. Today gains a `<Meal> · <Name>` event at 19:30 with an `↗ source` link (Task 3 render). `×` cancels without adding.

- [ ] **Step 6: Commit** (only if the user has asked to commit)

```bash
git add src/app/on-the-road/find-a-place.tsx
git commit -m "feat(ai): on-the-road accept = inline time confirm + source link (slice C)"
```

---

### Task 5: Planning door — inline day-picker + time confirm + link

**Files:**
- Modify: `src/app/trips/[slug]/find-a-place-planning.tsx`

**Interfaces:**
- Consumes: `addTodayEvent` with optional `url` (Task 2); `ItineraryDay` (`id`, `dayDate`, `d`, `date`).
- Produces: accept files the event under the chosen day of the browsed location.

- [ ] **Step 1: Add confirm state and a per-location day list**

After the `added` state line, add:
```tsx
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [selDayId, setSelDayId] = React.useState("")
  const [time, setTime] = React.useState("")
```
Then replace the `targetDay` derivation:
```tsx
  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const targetDay =
    days
      .filter((d) => d.locationId === location.id)
      .sort((a, b) => a.dayDate.localeCompare(b.dayDate))[0] ?? null
```
with a sorted day list for the location:
```tsx
  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const locDays = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
```

- [ ] **Step 2: Replace `addToItinerary` with a `commit` that uses the selected day, time, and url**

Change:
```tsx
  function addToItinerary(s: RestaurantSuggestion) {
    if (!targetDay) return
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: targetDay.dayDate,
      dayId: targetDay.id,
      time: "",
      text: `Dinner · ${s.name}`,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      router.refresh()
    })
  }
```
to:
```tsx
  function commit(s: RestaurantSuggestion) {
    const day = locDays.find((d) => d.id === selDayId) ?? locDays[0]
    if (!day) return
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: day.dayDate,
      dayId: day.id,
      time: time.trim(),
      text: `Dinner · ${s.name}`,
      url: s.sourceUrl,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      setConfirmingName(null)
      setTime("")
      router.refresh()
    })
  }
```

- [ ] **Step 3: Reset the confirm when the location changes**

In the location `<select>`'s `onChange`, alongside `setSuggestions(null)` and `setError(null)`, add `setConfirmingName(null)`:
```tsx
          onChange={(e) => {
            setLocId(e.target.value)
            setSuggestions(null)
            setError(null)
            setConfirmingName(null)
          }}
```

- [ ] **Step 4: Replace the per-suggestion button with a confirm-aware block**

Change:
```tsx
              <button
                type="button"
                onClick={() => addToItinerary(s)}
                disabled={!targetDay || added.has(s.name)}
                title={targetDay ? undefined : "Add a day to this location first"}
                className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {added.has(s.name)
                  ? "added"
                  : targetDay
                    ? `add to ${location.name}`
                    : "add a day first"}
              </button>
```
to:
```tsx
              {added.has(s.name) ? (
                <span className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                  added
                </span>
              ) : locDays.length === 0 ? (
                <span
                  title="Add a day to this location first"
                  className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add a day first
                </span>
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <select
                    value={selDayId}
                    onChange={(e) => setSelDayId(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                  >
                    {locDays.map((d) => (
                      <option key={d.id} value={d.id}>
                        Day {d.d} · {d.date}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="19:30"
                    className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commit(s)}
                    className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                  >
                    add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingName(null)
                      setTime("")
                    }}
                    aria-label="Cancel"
                    className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingName(s.name)
                    setSelDayId(locDays[0].id)
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add to {location.name}
                </button>
              )}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Manual check (390px viewport, non-active trip, AI on)**

On a dated trip's Itinerary tab, in the planning "find a place to eat" block: pick a location with ≥1 day, `find dinner`, tap `add to <location>` → a day `<select>` (Day N · date) + time field + `add`/`×` appears, day defaulting to the earliest. Choose a day, type `19:30`, `add`. That day gains `Dinner · <Name>` at 19:30 with an `↗ source` link, filed under the location. A location with zero days shows a disabled `add a day first`.

- [ ] **Step 7: Commit** (only if the user has asked to commit)

```bash
git add "src/app/trips/[slug]/find-a-place-planning.tsx"
git commit -m "feat(ai): planning accept = day-picker + time confirm + source link (slice C)"
```

---

## Notes for the implementer

- **Do not touch** `src/lib/trips/shared-trip-types.ts` (its own `parseEvents`) — the public `/t/` page intentionally stays link-less (deferred).
- **Do not add** URL validation. Store whatever the user/suggestion provides.
- The dream itinerary (`dream-itinerary-tab.tsx`) is out of scope — dreams have no discovery door.
- After all tasks, update `docs/TODO.md` (mark Slice C shipped) and consider whether any `docs/DECISIONS.md` row is warranted (the jsonb-no-migration choice is already implied by the spec; a row is optional).
