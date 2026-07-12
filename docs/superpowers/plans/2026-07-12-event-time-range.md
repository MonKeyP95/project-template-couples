# Optional Event End Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an itinerary event carry an optional end time so a timed event renders as a range (e.g. `18:00 → 20:00`), display-only.

**Architecture:** Add one optional `endTime` field to the schemaless `ItineraryEvent` jsonb blob (no migration), a single shared `formatEventTime()` helper, an editor input, and swap the six read surfaces to the formatter. Sorting and on-the-road "next/now" logic are untouched — they keep keying off the start `time`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. Package manager `pnpm`.

## Global Constraints

- **No test framework exists.** Do NOT invent a test command. Each task's verification cycle is: `pnpm lint` (clean) + `pnpm build` (clean) + the stated manual check. Copied verbatim from CLAUDE.md: "There are no tests yet; do not invent a test command until one exists."
- **No SQL migration.** `itinerary_days.events` is schemaless jsonb; the new field needs no DB change.
- **Display only.** `endTime` never participates in sorting or in "next / upcoming / past / now" logic.
- **Format:** `${time} → ${endTime}` (right arrow U+2192), just `${time}` when no end, `""` when untimed.
- **Storage key:** `endTime` (camelCase), omitted when empty — same convention as `url`.
- **No validation** that end is after start.
- **No emojis** in code, comments, or logs. Sparse comments; clear names.

---

### Task 1: Type field, parse, and shared formatter

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (interface ~line 4, `parseEvents` ~line 89, add `formatEventTime` export)

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - `ItineraryEvent.endTime?: string`
  - `formatEventTime(time: string, endTime?: string): string`

- [ ] **Step 1: Add the `endTime` field to the interface**

In `src/lib/trips/itinerary-types.ts`, change the `ItineraryEvent` interface (currently lines 4-14) to insert `endTime` right after `time`:

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
}
```

- [ ] **Step 2: Parse `endTime` in `parseEvents`**

In the `.map((e) => ({ ... }))` block of `parseEvents` (~lines 89-97), add an `endTime` spread immediately after the `time` line:

```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      ...(typeof e.endTime === "string" && e.endTime.length > 0
        ? { endTime: e.endTime }
        : {}),
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
      ...(typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5
        ? { rating: Math.round(e.rating) }
        : {}),
      ...(typeof e.note === "string" && e.note.length > 0 ? { note: e.note } : {}),
    }))
```

- [ ] **Step 3: Add the `formatEventTime` helper**

Add this exported pure function to `src/lib/trips/itinerary-types.ts` (place it near the other exported formatters, e.g. after `formatShortDate`):

```ts
/** "" when untimed, "18:00" with only a start, "18:00 → 20:00" with a range. */
export function formatEventTime(time: string, endTime?: string): string {
  if (!time) return ""
  return endTime ? `${time} → ${endTime}` : time
}
```

- [ ] **Step 4: Verify lint and build**

Run: `pnpm lint`
Expected: clean (no errors).

Run: `pnpm build`
Expected: build succeeds. Nothing consumes `endTime`/`formatEventTime` yet, so no visible change — this task only widens the type surface.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): add optional event endTime field and formatEventTime helper"
```

---

### Task 2: Editor input, save paths, and the itinerary planning surface

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`EventDraft` ~85, `newEventDraft` ~96, `toEventDrafts` ~121, `daySummary` ~137, planning-list render ~1342, edit-form save ~1451, add-form save ~1550, editor input ~1789)

**Interfaces:**
- Consumes: `ItineraryEvent.endTime`, `formatEventTime` from Task 1.
- Produces: `EventDraft.endTime: string`; editor writes `endTime` into the events jsonb.

- [ ] **Step 1: Add `endTime` to `EventDraft` and `newEventDraft`**

Change the `EventDraft` interface (~lines 85-94) to add `endTime`:

```ts
interface EventDraft {
  key: string
  time: string
  endTime: string
  text: string
  url: string
  /** Pass-through only — the planning form never edits these, but must not drop
   * them when saving other fields (they carry the post-experience rating). */
  rating?: number
  note?: string
}
```

Change `newEventDraft` (~lines 96-98) to accept `endTime` as the second positional arg:

```ts
function newEventDraft(time = "", endTime = "", text = "", url = ""): EventDraft {
  return { key: crypto.randomUUID(), time, endTime, text, url }
}
```

- [ ] **Step 2: Carry `endTime` through `toEventDrafts`**

Update `toEventDrafts` (~lines 121-127) so the new positional order and `endTime` pass-through are correct:

```ts
function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => ({
    ...newEventDraft(e.time, e.endTime ?? "", e.text, e.url ?? ""),
    rating: e.rating,
    note: e.note,
  }))
}
```

- [ ] **Step 3: Use the range in `daySummary`**

In `daySummary` (~lines 131-139), the single-event branch currently reads `` `${e.time} ${e.text}` ``. Import `formatEventTime` (add it to the existing import from `@/lib/trips/itinerary-types`) and change that line:

```ts
  if (evs.length === 1) {
    const e = evs[0]
    const label = formatEventTime(e.time, e.endTime)
    return label ? `${label} ${e.text}` : e.text
  }
```

- [ ] **Step 4: Render the range in the expanded planning list**

In the expanded-day event render (~lines 1342-1346), swap the bare `{ev.time}`:

```tsx
                    {ev.time ? (
                      <span className="t-num shrink-0 whitespace-nowrap text-foreground/70">
                        {formatEventTime(ev.time, ev.endTime)}
                      </span>
                    ) : null}
```

(`whitespace-nowrap` keeps the arrow form on one line.)

- [ ] **Step 5: Write `endTime` in both save paths**

In the edit-form save `events.map` (~lines 1451-1457) add an `endTime` spread after `time`:

```ts
        events: events.map((e) => ({
          time: normalizeTime(e.time),
          ...(e.endTime.trim() ? { endTime: normalizeTime(e.endTime.trim()) } : {}),
          text: e.text,
          ...(e.url.trim() ? { url: e.url.trim() } : {}),
          ...(typeof e.rating === "number" ? { rating: e.rating } : {}),
          ...(e.note && e.note.trim() ? { note: e.note.trim() } : {}),
        })),
```

Apply the identical `endTime` spread line to the add-form save `events.map` (~lines 1549-1555), immediately after its `time:` line.

- [ ] **Step 6: Add the end-time input in the editor**

In the Events editor row (~lines 1788-1813), add a second input immediately after the start-time input (the one with `placeholder="09:00"`), inside the same `<div className="flex items-center gap-2">`:

```tsx
              <input
                type="text"
                value={ev.endTime}
                onChange={(e) =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, endTime: e.target.value } : x,
                    ),
                  )
                }
                onBlur={() =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key
                        ? { ...x, endTime: normalizeTime(x.endTime) }
                        : x,
                    ),
                  )
                }
                placeholder="end"
                disabled={isPending}
                className="t-num w-16 shrink-0 border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
```

Note: the end-time `onBlur` normalizes only; it does NOT re-sort (sorting keys off the start `time`, which is unchanged).

- [ ] **Step 7: Verify lint and build**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Manual check in the running app**

Run: `pnpm dev`, open a trip's Itinerary tab, edit a day.
- Add an event with start `18:00` and end `20:00`, save → the expanded list shows `18:00 → 20:00`.
- Add an event with only a start `09:00` → shows `09:00`.
- Reload the page → the range persists (round-trips through jsonb parse).

- [ ] **Step 9: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): edit and display optional event end time as a range"
```

---

### Task 3: Propagate the range to the remaining read surfaces

**Files:**
- Modify: `src/app/home/today-next-event.tsx` (~line 60)
- Modify: `src/app/on-the-road/looking-ahead-panel.tsx` (~line 8)
- Modify: `src/app/on-the-road/today-upcoming.tsx` (~line 67)
- Modify: `src/app/on-the-road/today-past.tsx` (~line 70)
- Modify: `src/app/t/[token]/page.tsx` (~line 96)

**Interfaces:**
- Consumes: `formatEventTime` from Task 1 (and `ItineraryEvent.endTime`).
- Produces: nothing.

- [ ] **Step 1: home `today-next-event`**

Import `formatEventTime` from `@/lib/trips/itinerary-types` (the file already imports `ItineraryEvent` from there). Change the render (~line 60):

```tsx
      <span className="t-num whitespace-nowrap">
        {formatEventTime(pick.time, pick.endTime)}
      </span>{" "}
      · {pick.text}
```

- [ ] **Step 2: `looking-ahead-panel`**

The file already imports `formatShortDate` from `@/lib/trips/itinerary-types`; add `formatEventTime` to that import. `ahead.tomorrowEvent` is an `ItineraryEvent`. Change the label build (~lines 7-9):

```tsx
  const tomorrowText = ahead.tomorrowEvent
    ? `${formatEventTime(ahead.tomorrowEvent.time, ahead.tomorrowEvent.endTime)} · ${ahead.tomorrowEvent.text}`
    : ahead.tomorrowTitle
```

- [ ] **Step 3: on-the-road `today-upcoming`**

Import `formatEventTime` from `@/lib/trips/itinerary-types`. Change the timed branch (~lines 66-67):

```tsx
          {e.time ? (
            <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
              {formatEventTime(e.time, e.endTime)}
            </span>
          ) : (
```

- [ ] **Step 4: on-the-road `today-past`**

Import `formatEventTime` from `@/lib/trips/itinerary-types`. Change the time span (~lines 69-71):

```tsx
              <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
                {formatEventTime(e.time, e.endTime)}
              </span>
```

- [ ] **Step 5: share page `t/[token]`**

Import `formatEventTime` from `@/lib/trips/itinerary-types`. The time column pins `w-12` (~line 96), which clips the wider range; relax it to auto width with nowrap:

```tsx
              {e.time ? (
                <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
                  {formatEventTime(e.time, e.endTime)}
                </span>
              ) : (
                <span className="w-12 shrink-0" />
              )}
```

(Leave the untimed spacer `<span className="w-12 shrink-0" />` as-is.)

- [ ] **Step 6: Verify lint and build**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Manual check**

With `pnpm dev` running and an event that has a `18:00 → 20:00` range on today's / tomorrow's date:
- home "next/last" line shows the range,
- on-the-road upcoming and looking-back show the range without clipping,
- open the trip's public share link (`/t/<token>`) → the range shows without truncation.

- [ ] **Step 8: Commit**

```bash
git add src/app/home/today-next-event.tsx src/app/on-the-road/looking-ahead-panel.tsx src/app/on-the-road/today-upcoming.tsx src/app/on-the-road/today-past.tsx "src/app/t/[token]/page.tsx"
git commit -m "feat(itinerary): show event time range on home, on-the-road, and share surfaces"
```

---

## Post-implementation

- [ ] Update `docs/TODO.md` (mark the event time-range item done, or add a done line).
- [ ] If any non-obvious choice surfaced, append a row to `docs/DECISIONS.md`. (The camelCase `endTime` jsonb key and "display-only, no sort impact" are candidates.)

## Self-Review notes

- **Spec coverage:** type+parse+formatter (Task 1); editor input, `EventDraft`, both save paths, planning list, `daySummary` (Task 2); the six read surfaces + width relaxations (Tasks 2-3, share page in Task 3). Out-of-scope items (event creators, "happening now", validation) are intentionally untouched — no task. All spec sections covered.
- **Type consistency:** `formatEventTime(time, endTime?)` signature identical across all call sites; `newEventDraft(time, endTime, text, url)` new arg order reflected in `toEventDrafts` and the arg-less `newEventDraft()` at the add-event button (~line 1921 still valid). `EventDraft.endTime` is a required `string` ("" when absent); `ItineraryEvent.endTime` is optional.
- **No placeholders:** every code step carries full code.
