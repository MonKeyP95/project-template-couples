# Itinerary block name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user name a multi-day itinerary block when creating it in the Add-a-day form; the block caption shows that name instead of the fixed "added together".

**Architecture:** One nullable `group_name` column on `itinerary_days`, denormalized across a span's rows. `addItineraryDay` stamps the name on every row of a 2+ day span (alongside the existing `group_id`). The name rides the same threading path as `group_id` (row type → mapper → query select → Realtime row). A "Block name" field appears in the Add form only when a "to" date is set; the caption is display-only.

**Tech Stack:** Next.js 16 App Router, React 19, Server Actions, Supabase Postgres + Realtime, TypeScript 5.

**Note on testing:** This repo has no test suite (per `CLAUDE.md` — do not invent a test command). Each task is verified with `pnpm build` and `pnpm lint`, plus a manual viewing step at the end. Commit after each task.

---

### Task 1: Schema — add `group_name` column

**Files:**
- Create: `supabase/migrations/20260603000003_itinerary_group_name.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Itinerary block name.
-- A multi-day add can carry a name (e.g. "Rinjani Trek"); it is stamped on
-- every row of the span alongside group_id so the UI caption can show it.
-- Single-day adds and pre-existing rows leave group_name null. Inherits the
-- table's existing RLS; no index.

alter table public.itinerary_days add column if not exists group_name text;
```

- [ ] **Step 2: Apply it to the Supabase project**

Run the SQL in the Supabase dashboard SQL editor (or via your usual apply step). It is idempotent — safe to paste and run more than once (`add column if not exists`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603000003_itinerary_group_name.sql
git commit -m "feat(itinerary): add group_name column"
```

---

### Task 2: Thread `group_name` through the type layer

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

- [ ] **Step 1: Add `groupName` to `ItineraryDay`**

In `src/lib/trips/itinerary-types.ts`, add the field to the `ItineraryDay` interface, right after `groupId`:

```ts
  /** Shared id for days added as one multi-day span; null when ungrouped. */
  groupId: string | null
  /** Name of the multi-day block; null when unnamed or ungrouped. */
  groupName: string | null
```

- [ ] **Step 2: Add `group_name` to `ItineraryRow`**

In the same file, add to the `ItineraryRow` interface after `group_id`:

```ts
  group_id?: string | null
  group_name?: string | null
```

- [ ] **Step 3: Map it in `rowToItineraryDay`**

In `rowToItineraryDay`, add the mapping right after the `groupId` line:

```ts
    groupId: row.group_id ?? null,
    groupName: row.group_name ?? null,
```

- [ ] **Step 4: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds (note: `withOrdinals` spreads `...day`, so `groupName` is preserved automatically — no change needed there).

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): thread groupName through types"
```

---

### Task 3: Select `group_name` in the query

**Files:**
- Modify: `src/lib/trips/itinerary-queries.ts:15`

- [ ] **Step 1: Add `group_name` to the select**

Change the `.select(...)` on line 15 from:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, location_id")
```

to:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/itinerary-queries.ts
git commit -m "feat(itinerary): select group_name on load"
```

---

### Task 4: Accept and store `groupName` in `addItineraryDay`

**Files:**
- Modify: `src/lib/trips/actions.ts` (`AddItineraryDayInput` ~832, `addItineraryDay` ~876)

- [ ] **Step 1: Add `groupName` to `AddItineraryDayInput`**

In `src/lib/trips/actions.ts`, add the optional field to `AddItineraryDayInput`, after `endDate`:

```ts
  /** Optional inclusive end date. When later than dayDate, one entry per day in the range is created. */
  endDate?: string
  /** Optional name for a multi-day block; only used when a span (2+ days) is created. */
  groupName?: string
```

- [ ] **Step 2: Compute `groupName` next to `groupId`**

In `addItineraryDay`, find:

```ts
  // A multi-day span shares one group_id so the UI can mark "added together".
  const groupId = dates.length > 1 ? crypto.randomUUID() : null
```

Add right below it:

```ts
  // Only a span carries a name; a blank field stores null.
  const groupName = dates.length > 1 ? input.groupName?.trim() || null : null
```

- [ ] **Step 3: Add `group_name` to the inserted rows**

In the `dates.map(...)` row object, add after `group_id: groupId,`:

```ts
    group_id: groupId,
    group_name: groupName,
```

- [ ] **Step 4: Add `group_name` to the insert select**

Change the insert `.select(...)` from:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, location_id")
```

to:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 5: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): store group_name on multi-day adds"
```

---

### Task 5: Add the Block-name field to the Add form

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`AddDayRow` ~760, `DayForm` ~845, `RealtimeRow` ~40)

- [ ] **Step 1: Add `group_name` to `RealtimeRow`**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add to the `RealtimeRow` interface after `group_id`:

```ts
  group_id: string | null
  group_name: string | null
```

- [ ] **Step 2: Add `groupName` state to `AddDayRow`**

In `AddDayRow`, add a state hook next to the others (after the `endDate` state):

```ts
  const [endDate, setEndDate] = React.useState("")
  const [groupName, setGroupName] = React.useState("")
```

- [ ] **Step 3: Clear it in `reset()`**

In `AddDayRow`'s `reset()`, add after `setEndDate("")`:

```ts
    setEndDate("")
    setGroupName("")
```

- [ ] **Step 4: Pass `groupName` to the action**

In `AddDayRow`'s `submit`, add `groupName` to the `addItineraryDay({ ... })` call (after `endDate`):

```ts
        dayDate,
        endDate,
        groupName,
```

- [ ] **Step 5: Pass `groupName` props to `DayForm`**

In the `<DayForm .../>` rendered by `AddDayRow`, add after the `endDate`/`setEndDate` props:

```tsx
      endDate={endDate}
      setEndDate={setEndDate}
      groupName={groupName}
      setGroupName={setGroupName}
```

- [ ] **Step 6: Add the props to `DayForm`'s signature**

In `DayForm`'s prop type, add after the `setEndDate?` line:

```ts
  endDate?: string
  setEndDate?: (s: string) => void
  /** When provided (Add mode), the block-name field for multi-day spans. */
  groupName?: string
  setGroupName?: (s: string) => void
```

And add `groupName, setGroupName,` to the destructured params list (next to `endDate, setEndDate,`).

- [ ] **Step 7: Render the field only when a "to" date is set**

In `DayForm`, immediately after the closing `</div>` of the `grid grid-cols-2` block that holds From/To (the block ending around the From/To `</div>`), and after the existing span-only Tag field, add the block-name field. Place it right after the `{setEndDate ? ( ...Tag... ) : null}` block:

```tsx
      {setEndDate && setGroupName && endDate ? (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Block name
          </span>
          <input
            type="text"
            value={groupName ?? ""}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Optional, e.g. Rinjani Trek"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
      ) : null}
```

- [ ] **Step 8: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): block-name field in Add-day form"
```

---

### Task 6: Show the name in the block caption

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (segment branch ~489-500)

- [ ] **Step 1: Use `groupName` in the caption**

In the multi-day segment branch (`if (seg.groupId && seg.days.length > 1)`), replace the fixed caption:

```tsx
                            <span className="absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                              added together
                            </span>
```

with one that prefers the block name (a named block reads as a real label, not muted):

```tsx
                            <span
                              className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                                seg.days[0].groupName
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {seg.days[0].groupName ?? "added together"}
                            </span>
```

- [ ] **Step 2: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): show block name in caption"
```

---

### Task 7: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Open a trip's itinerary tab at http://localhost:3000.

- [ ] **Step 2: Verify the field is conditional**

In a location group, click **+ day**. Confirm: with **no** "to" date, there is NO "Block name" field. Set a "to" date later than "from" — the **Block name** field appears.

- [ ] **Step 3: Create a named span**

Enter a tag, title, a "to" date a couple of days out, and a block name (e.g. "Rinjani Trek"). Submit. Confirm: the new days appear inside the rounded border, and the caption reads **RINJANI TREK** (uppercased by the mono style), styled as a real label.

- [ ] **Step 4: Verify blank falls back**

Create another span with the Block name left blank. Confirm the caption still reads **added together** (muted).

- [ ] **Step 5: Verify a single day shows no caption**

Add one day with no "to" date. Confirm no border and no caption.

- [ ] **Step 6: Verify per-day edits keep the name**

Edit one day inside a named span (change its title). Confirm the block caption still shows the name after saving.

- [ ] **Step 7: Update docs**

Add a row to `docs/DECISIONS.md` if the denormalized `group_name` choice is worth recording, and tick the relevant item in `docs/TODO.md`.

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record block-name decision and todo"
```

---

## Self-Review

- **Spec coverage:** Schema (Task 1) ✓; action stamps name on spans only, blank → null (Task 4) ✓; threading through row/type/mapper/query/Realtime (Tasks 2, 3, 5) ✓; Add-form field shown only when a "to" date is set (Task 5) ✓; display-only caption with fallback (Task 6) ✓; per-day-edit survival + pre-existing-null fallback verified (Task 7) ✓. Dream itinerary untouched ✓.
- **Type consistency:** `groupName` (camel, app types/state) vs `group_name` (snake, DB/row/select) used consistently; `setGroupName: (s: string) => void` matches `setEndDate`'s signature.
- **No placeholders:** every code step shows the actual code.
