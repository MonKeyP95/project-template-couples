# Free-Text Details on an Itinerary Event — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each itinerary event carries an optional free-text `details` string, authored in the day editor, shown inside an expanded day and on the on-the-road upcoming list.

**Architecture:** One new optional field on `ItineraryEvent`. Six existing places re-shape an event and must carry it; two others already spread and need no change. Two read surfaces render it. No migration — events are jsonb.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Server Actions, Supabase.

## Global Constraints

- **No test suite exists in this repo.** Verification is `pnpm lint` + `pnpm exec tsc --noEmit` + reasoning, plus `pnpm build` only when the dev server is stopped.
- **Never run `pnpm build` while `pnpm dev` is running** — they share `.next/`.
- No emojis. Sparse comments. `en-GB` date order (nothing here formats dates).
- Do NOT add `details` to `src/lib/trips/shared-trip-types.ts` — the public share strips it on purpose.
- Spec: `docs/superpowers/specs/2026-07-29-event-details-design.md`.

---

### Task 1: Carry `details` through the data path and author it in the day editor

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (`ItineraryEvent` ~line 4; `parseEvents` ~line 90)
- Modify: `src/lib/trips/actions.ts` (`normalizeDayEvents` ~line 1487)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`EventDraft` ~108, `newEventDraft` ~123, `toEventDrafts` ~148, edit-day save ~1519, add-day save ~1619, editor UI ~1933)

**Interfaces:**
- Produces: `ItineraryEvent.details?: string`; `newEventDraft(time?, endTime?, text?, url?, details?)`; `EventDraft.details: string`.

- [ ] **Step 1: Add the field to the type**

In `src/lib/trips/itinerary-types.ts`, inside `ItineraryEvent`, after the `url` field:

```ts
  /** Optional free-text details — address, booking name, "cash only". Shown
   * inside an expanded day and on the road, never in a public share. */
  details?: string
```

- [ ] **Step 2: Read it back in `parseEvents`**

In the same file, in `parseEvents`, after the `url` spread line:

```ts
      ...(typeof e.details === "string" && e.details.length > 0
        ? { details: e.details }
        : {}),
```

- [ ] **Step 3: Preserve it on write**

In `src/lib/trips/actions.ts`, in `normalizeDayEvents`, after the `url` spread line:

```ts
      ...(typeof e.details === "string" && e.details.trim()
        ? { details: e.details.trim() }
        : {}),
```

Update that function's docstring — the existing text names the fields it preserves:

```ts
/** Normalize client-supplied events to the stored jsonb shape, dropping empties.
 * Preserves every optional field (endTime, url, details, rating, note) so a save
 * never discards them. Shared by all itinerary write paths. */
```

- [ ] **Step 4: Carry it on the editor's draft**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add to `EventDraft` after `url`:

```ts
  details: string
```

Then replace `newEventDraft`:

```ts
function newEventDraft(time = "", endTime = "", text = "", url = "", details = ""): EventDraft {
  return { key: crypto.randomUUID(), time, endTime, text, url, details }
}
```

Then in `toEventDrafts`, pass it through:

```ts
    ...newEventDraft(e.time, e.endTime ?? "", e.text, e.url ?? "", e.details ?? ""),
```

- [ ] **Step 5: Carry it on both saves**

In both draft-to-event maps — the edit-day save (~line 1519) and the add-day save (~line 1619) — add one line after the `url` spread. The line is identical in both:

```ts
          ...(e.details.trim() ? { details: e.details.trim() } : {}),
```

- [ ] **Step 6: Add the editor input**

In the same file, immediately after the "link (optional)" `<input>` that closes the event row (~line 1946), add:

```tsx
              <textarea
                value={ev.details}
                onChange={(e) =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, details: e.target.value } : x,
                    ),
                  )
                }
                placeholder="details (optional) — address, booking name, what to bring"
                rows={2}
                disabled={isPending}
                className="w-full resize-y border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
```

- [ ] **Step 7: Verify**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

Expected: both clean.

Then confirm the public share was not touched:

```bash
grep -n "details" src/lib/trips/shared-trip-types.ts
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/actions.ts "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): an event carries free-text details"
```

---

### Task 2: Show details in an expanded day and on the road

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (expanded-day event render ~line 1400)
- Modify: `src/app/on-the-road/today-upcoming.tsx` (~line 75)

**Interfaces:**
- Consumes: `ItineraryEvent.details` from Task 1. No new exports.

- [ ] **Step 1: Render details under the event in an expanded day**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the expanded-day event block currently closes its flex row after the `ev.url` link. Immediately after that closing `</div>` and before the `{openExpense === i ? (` line, add:

```tsx
                  {ev.details ? (
                    <p className="mt-0.5 whitespace-pre-line text-[12px] leading-snug text-muted-foreground/80">
                      {ev.details}
                    </p>
                  ) : null}
```

`whitespace-pre-line` keeps the line breaks the couple typed. This sits inside the expanded branch, so a collapsed day shows nothing — the day press is the reveal.

- [ ] **Step 2: Render details on the road**

In `src/app/on-the-road/today-upcoming.tsx`, the list item is currently a single flex row. Replace the `<li>` body so the details sit under the text, indented past the time column:

```tsx
        <li
          key={`${e.time}-${e.text}-${i}`}
          className="flex flex-col gap-0.5 text-[13px] text-foreground"
        >
          <div className="flex gap-2">
            {e.time ? (
              <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
                {formatEventTime(e.time, e.endTime)}
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                anytime
              </span>
            )}
            <span>{e.text}</span>
          </div>
          {e.details ? (
            <p className="whitespace-pre-line pl-1 text-[12px] leading-snug text-muted-foreground">
              {e.details}
            </p>
          ) : null}
        </li>
```

Leave `today-past.tsx` alone — details on an event that already happened are noise.

- [ ] **Step 3: Verify**

```bash
pnpm exec tsc --noEmit && pnpm lint
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx" src/app/on-the-road/today-upcoming.tsx
git commit -m "feat(itinerary): show event details in an expanded day and on the road"
```

- [ ] **Step 5: Update the docs**

Add a TODO entry in the house style (bold lead, what changed, success criteria the user verifies in app) and a DECISIONS row for the `details`-vs-`note` split and the public-share exclusion. Then:

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record event details"
```

---

## Self-review

**Spec coverage:** §1 field → Task 1 step 1. §2 authoring → Task 1 steps 4-6. §3 planning read → Task 2 step 1. §4 on-the-road read → Task 2 step 2. §5 write path, all six sites → Task 1 steps 1-5 (`ItineraryEvent`, `parseEvents`, `normalizeDayEvents`, `EventDraft`/`newEventDraft`/`toEventDrafts`, both saves). §6 share exclusion → Global Constraints + Task 1 step 7 grep.

**Type consistency:** `details` is `string` on `EventDraft` (always present, defaults `""`) and `details?: string` on `ItineraryEvent` (omitted when empty). The draft-to-event maps bridge the two with `e.details.trim() ? … : {}`, matching how `url` already works.
