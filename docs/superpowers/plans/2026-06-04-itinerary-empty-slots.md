# Itinerary empty slots (gap days) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the empty calendar days between an itinerary group's planned days as faint, read-only slots, so a gap (e.g. Jun 12 then Jun 15) shows the missing Jun 13–14 as visible buffer days.

**Architecture:** Pure rendering, driven entirely by the dates already in the data — no schema change, no actions, no DB. This is build-slice 1 of the "dated anchors" spec (`docs/superpowers/specs/2026-06-04-itinerary-gap-days-design.md`); click-to-fill, the overflow push, and location date spans are slices 2 and 3 (planned separately). Two pure helpers compute the gap dates and format their labels; the itinerary tab renders an empty-slot card for each gap date between consecutive day-segments.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5. Client component (`itinerary-tab.tsx`) + pure helpers in `itinerary-types.ts`.

**Note on testing:** This repo has no test suite (per `CLAUDE.md` — do not invent a test command). Each task is verified with `pnpm build` and `pnpm lint`, plus a manual viewing step at the end. Commit after each task.

**Note on the trek box:** Empty slots appear only *between* day-segments. A `group_id` "added together" block is contiguous by construction, so it never has an internal gap — gaps only fall between segments. Slots are rendered strictly between covered dates (never before the group's first day or after its last).

---

### Task 1: Pure helpers — `gapDates` and `formatShortDate`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

These live in `itinerary-types.ts` (not `itinerary-queries.ts`) because the client component imports them, and `itinerary-queries.ts` pulls `next/headers` via the server Supabase client — importing from it would break the client bundle (the `*-types.ts` split rule). `SHORT_DATE_FMT` already exists in this file (used by `rowToItineraryDay`); `formatShortDate` reuses it.

- [ ] **Step 1: Add the two helpers**

In `src/lib/trips/itinerary-types.ts`, add at the end of the file (after `withOrdinals`):

```ts
/** yyyy-mm-dd dates strictly between `a` and `b` (both exclusive), ascending.
 * Empty when the two dates are adjacent, equal, or out of order. */
export function gapDates(a: string, b: string): string[] {
  const out: string[] = []
  const d = new Date(`${a}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  const end = new Date(`${b}T00:00:00Z`)
  while (d < end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** "Jun 12"-style short UTC date for a yyyy-mm-dd string. */
export function formatShortDate(dayDate: string): string {
  return SHORT_DATE_FMT.format(new Date(`${dayDate}T00:00:00Z`))
}
```

- [ ] **Step 2: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): gapDates + formatShortDate helpers"
```

---

### Task 2: Render empty-slot cards between segments

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (import line ~15-20; segment map ~476-514)

The day list inside an open group renders `toSegments(group.days).map(...)`, where each `seg` is either a single-day fragment or a multi-day `group_id` box. We switch to a counted map and, before every segment after the first, emit one empty-slot card per missing date between the previous segment's last day and the current segment's first day. Segments are already date-ordered because `group.days` is sorted by date in `buildGroups`.

- [ ] **Step 1: Import the new helpers**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the existing import from `itinerary-types` is:

```ts
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
```

Change it to add the two helpers:

```ts
import {
  ITINERARY_TONES,
  formatShortDate,
  gapDates,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
```

- [ ] **Step 2: Add empty slots between segments**

Find the segment map (around line 476). It currently reads:

```tsx
                    {toSegments(group.days).map((seg) => {
                      const cards = seg.days.map((day) => (
```

Replace that opening line with a counted map that captures the segment array, and compute the gap before each segment:

```tsx
                    {(() => {
                      const segs = toSegments(group.days)
                      return segs.map((seg, si) => {
                        const prev = si > 0 ? segs[si - 1] : null
                        const gap = prev
                          ? gapDates(
                              prev.days[prev.days.length - 1].dayDate,
                              seg.days[0].dayDate,
                            )
                          : []
                        const emptySlots = gap.map((gd) => (
                          <div
                            key={`empty-${gd}`}
                            className="my-1 flex items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2"
                          >
                            <span className="t-num w-12 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                              {formatShortDate(gd)}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                              empty
                            </span>
                          </div>
                        ))
                      const cards = seg.days.map((day) => (
```

(The `const cards = seg.days.map((day) => (` line is the original next line — it is shown here so you keep it; it now sits inside the new arrow function with one extra indent level.)

- [ ] **Step 3: Prepend the empty slots to each segment's output**

The segment map currently returns one of two shapes. Find the multi-day branch:

```tsx
                      if (seg.groupId && seg.days.length > 1) {
                        return (
                          <div
                            key={seg.groupId}
                            className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1"
                          >
```

Wrap its return in a fragment that renders `emptySlots` first:

```tsx
                      if (seg.groupId && seg.days.length > 1) {
                        return (
                          <React.Fragment key={seg.groupId}>
                            {emptySlots}
                            <div className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1">
```

Then find the matching close of that `<div>` and the `)` / `}` that end this branch. It currently reads:

```tsx
                            {cards}
                          </div>
                        )
                      }
```

Change it to close the inner `<div>` and the new `<React.Fragment>`:

```tsx
                            {cards}
                            </div>
                          </React.Fragment>
                        )
                      }
```

(Note: the inner `<div>` lost its `key` — the key now lives on the `React.Fragment`. The `className` moved onto the same `<div>` line in Step 3's first edit.)

- [ ] **Step 4: Prepend empty slots to the single-day branch too**

The single-day branch currently reads:

```tsx
                      return (
                        <React.Fragment key={seg.days[0].id}>
                          {cards}
                        </React.Fragment>
                      )
                    })}
```

Add `emptySlots` before `cards`, and close the IIFE that Step 2 opened:

```tsx
                        return (
                          <React.Fragment key={seg.days[0].id}>
                            {emptySlots}
                            {cards}
                          </React.Fragment>
                        )
                      })
                    })()}
```

- [ ] **Step 5: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds. If it fails with a JSX nesting error, re-check that the IIFE opened in Step 2 (`{(() => { ... return segs.map((seg, si) => {`) is closed in Step 4 (`})` for the map callback, then `})()}` for the IIFE), and that the `React.Fragment` opened in Step 3 is closed.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): show empty-day slots between planned days"
```

---

### Task 3: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md` / `docs/DECISIONS.md`.

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Open a trip's itinerary tab at http://localhost:3000.

- [ ] **Step 2: Verify a gap renders empty slots**

In a location group, ensure two days exist with a gap between them (e.g. add a day on a date, then another 2–3 days later). Confirm: faint dashed "empty" cards appear for each missing date *between* them, labelled with the date, in order.

- [ ] **Step 3: Verify no slots at the edges**

Confirm there are NO empty cards before the group's first day or after its last day — only between covered dates.

- [ ] **Step 4: Verify the trek box is unaffected**

Confirm a multi-day `group_id` block (an "added together" box) shows no empty slots inside it, and that a gap between a trek box and the next day still renders empty slots between them.

- [ ] **Step 5: Update docs**

Add a row to `docs/TODO.md` recording build-slice 1 done (empty-slot rendering), referencing the spec, and noting slices 2 (click-to-fill + overflow push) and 3 (location date spans) are still to come.

```bash
git add docs/TODO.md
git commit -m "docs: record itinerary empty-slots (Slice 2 build-1) done"
```

---

## Self-Review

- **Spec coverage:** This plan covers the spec's build-slice 1 ("Render empty slots between days") only — pure UI, no DB. Spec build-slices 2 (click-to-fill + overflow push via `shift_itinerary_from`) and 3 (location date spans) are explicitly out of this plan and will be planned next. ✓
- **No placeholders:** every code step shows the actual code, including the exact JSX open/close changes. ✓
- **Type consistency:** `gapDates(a, b): string[]` and `formatShortDate(dayDate): string` are defined in Task 1 and used with those exact signatures in Task 2. `seg.days[i].dayDate` matches the `ItineraryDay.dayDate` field. ✓
- **Client/server split:** helpers live in `itinerary-types.ts` (client-safe), not `itinerary-queries.ts`. ✓
- **Risk:** the only fragile part is the JSX restructure in Task 2; Step 5 calls out exactly what to re-check if the build fails on nesting.
