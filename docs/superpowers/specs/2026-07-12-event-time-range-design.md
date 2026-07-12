# Optional end time on itinerary events

**Date:** 2026-07-12
**Status:** Approved, ready for planning
**Scope:** Display-only. One optional field, one shared formatter, editor input, and the display surfaces. No migration, no behavior change.

## Goal

Let an itinerary event carry an optional end time so a timed event can read as a
range, e.g. `18:00 → 20:00` for dinner. The end time is purely cosmetic: it
renders wherever a time already shows and changes nothing about sorting or
on-the-road "next / upcoming / past" logic.

## Decisions (from brainstorming)

- **Display only.** The end time never participates in sorting or in
  "happening now / next event" logic. Those all continue to key off the start
  `time` alone.
- **Format:** `start → end` with a right arrow, e.g. `18:00 → 20:00`. When no
  end is set, just the start renders as today.
- **No validation.** Consistent with the existing "time is a cosmetic label, no
  parsing" ethos. We do not enforce that end is after start.

## Data shape

`itinerary_days.events` is a schemaless jsonb array, so this needs **no SQL
migration**. Add one optional field to `ItineraryEvent` in
`src/lib/trips/itinerary-types.ts`:

```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  /** Optional "HH:MM"-style end label. Omitted when absent. Cosmetic. */
  endTime?: string
  text: string
  url?: string
  rating?: number
  note?: string
}
```

Storage key is `endTime` (camelCase, matching the TS field; the blob is
app-owned). It is **omitted when empty**, following the same convention as
`url`.

`parseEvents` (itinerary-types.ts ~line 89) reads it the same tolerant way as
`url`:

```ts
...(typeof e.endTime === "string" && e.endTime.length > 0
  ? { endTime: e.endTime }
  : {}),
```

Old rows have no `endTime` and are unaffected.

## Shared formatter

Add one pure helper to `itinerary-types.ts` (already imported by every surface
that shows a time), so the arrow form stays consistent everywhere:

```ts
/** "" when untimed, "18:00" with only a start, "18:00 → 20:00" with a range. */
export function formatEventTime(time: string, endTime?: string): string {
  if (!time) return ""
  return endTime ? `${time} → ${endTime}` : time
}
```

## Editor (`src/app/trips/[slug]/itinerary-tab.tsx`)

- `EventDraft` (~line 85) gains `endTime: string`.
- `newEventDraft(time = "", endTime = "", text = "", url = "")` sets it;
  `toEventDrafts` maps `e.endTime ?? ""` through.
- Add a second text input in the Events editor rows (~line 1789), placed
  immediately after the start-time input, `placeholder="end"`, same
  `normalizeTime` on blur, same `t-num w-16` styling. The `×` remove button and
  the text input stay where they are.
- Both save paths that serialize drafts to jsonb (~line 1451 in the edit form
  and the matching block in the add form ~line 1550) include it, omitting when
  blank:

  ```ts
  ...(e.endTime.trim() ? { endTime: normalizeTime(e.endTime.trim()) } : {}),
  ```

## Sorting stays untouched

`sortEvents` and every `e.time`-based comparison (home `today-next-event`,
on-the-road `today-upcoming` / `today-past`, `looking-ahead`) keep keying off
the start `time` only. `endTime` is never read for ordering or "now" logic.

## Display surfaces

Swap the bare `{ev.time}` render for `{formatEventTime(ev.time, ev.endTime)}`
in each place a time is shown:

1. `src/app/trips/[slug]/itinerary-tab.tsx` — planning list (~line 1342) and the
   collapsed `daySummary` (~line 137, `${e.time} ${e.text}` becomes
   `${formatEventTime(e.time, e.endTime)} ${e.text}`).
2. `src/app/home/today-next-event.tsx` (~line 60).
3. `src/app/on-the-road/looking-ahead-panel.tsx` (~line 8) — via the
   `tomorrowEvent` label; use the formatter where that string is built.
4. `src/app/on-the-road/today-upcoming.tsx` (~line 67).
5. `src/app/on-the-road/today-past.tsx` (~line 70).
6. `src/app/t/[token]/page.tsx` (~line 96) — the public share page.

### Width tweak

Two surfaces pin the time column to a fixed width sized for `18:00`
(share page `w-12 shrink-0`, and any `t-num shrink-0` column that would clip).
Relax those to `whitespace-nowrap` with auto width so the wider arrow form does
not truncate. This is a per-surface class change only — no layout redesign.

## Explicitly out of scope

- **Event creators** `discovery-section.tsx` and on-the-road
  `add-today-event.tsx` keep creating single-time events; they do not gain an
  end-time input in this slice.
- **"Happening now"** highlighting (start ≤ now ≤ end) on the road — a natural
  future extension, not built here.
- Any end-before-start validation.

## Files touched

- `src/lib/trips/itinerary-types.ts` — type field, parse, `formatEventTime`.
- `src/app/trips/[slug]/itinerary-tab.tsx` — draft type, editor input, two save
  paths, planning-list render, `daySummary`.
- `src/app/home/today-next-event.tsx`
- `src/app/on-the-road/looking-ahead-panel.tsx`
- `src/app/on-the-road/today-upcoming.tsx`
- `src/app/on-the-road/today-past.tsx`
- `src/app/t/[token]/page.tsx`

No migration. No new dependency.

## Verification

- `pnpm lint` and `pnpm build` clean.
- In the itinerary editor, add an event with both times → planning list shows
  `18:00 → 20:00`; add one with only a start → shows `18:00`; untimed → no time.
- Reload: the range persists (round-trips through jsonb parse).
- Share page and on-the-road surfaces show the range without clipping.
