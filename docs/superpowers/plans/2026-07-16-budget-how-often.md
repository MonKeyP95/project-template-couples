# Budget "How often" Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Execute task-by-task; validate with `pnpm lint` + `pnpm build` (no test framework in this repo).

**Goal:** Add a per-row "How often" control (Once / × times / Daily) to the budget walk, so a line's total is `unit price × quantity` — where the quantity is 1, a typed count, a dated span, or the row's day-slots.

**Architecture:** One `freq` + `count` pair on each walk row (and on `trip_budget_items`). Quantity resolves in the drafter from `freq`, the optional date range (reused from last session), and day-slots counted from the `itineraryDays` the drafter already holds. `amount_cents` stays the computed total, so settle-up/expense math is untouched; restore divides the total back to the per-unit price.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (manual SQL migrations).

## Global Constraints

- No emojis in code/logs. Sparse comments. European dates (`en-GB`).
- Migrations idempotent (`add column if not exists`), pasted into Supabase by hand.
- Suggest-only invariant unchanged; Generate flattens filled rows to `once` (totals preserved).
- Validate each task with `pnpm lint` + `pnpm build`.

---

### Task 1: Migration — `freq` + `count` columns

**Files:**
- Create: `supabase/migrations/20260716000001_budget_item_freq.sql`

- [ ] **Step 1: Write the idempotent migration**

```sql
-- How-often model for budget walk rows: a line's total is unit price x quantity.
-- freq drives the quantity source: once (1), times (count or a dated span),
-- daily (the row's day-slots). amount_cents stays the computed total.
alter table trip_budget_items
  add column if not exists freq text not null default 'once';
alter table trip_budget_items
  add column if not exists count integer not null default 1;
```

- [ ] **Step 2: Commit** (the file is applied in Supabase by hand later)

```bash
git add supabase/migrations/20260716000001_budget_item_freq.sql
git commit -m "feat(budget): migration adds freq+count to trip_budget_items"
```

---

### Task 2: Item types + query carry `freq`/`count`

**Files:**
- Modify: `src/lib/trips/budget-item-types.ts`
- Modify: `src/lib/trips/budget-item-queries.ts`

**Interfaces:**
- Produces: `BudgetItem.freq: string`, `BudgetItem.count: number`.

- [ ] **Step 1: Add fields to `BudgetItem`** (after `priceUnknown`)

```ts
  /** How the amount multiplies: "once" | "times" | "daily". */
  freq: string
  /** The multiplier for "times"; 1 otherwise. */
  count: number
```

- [ ] **Step 2: Add snake_case fields to `BudgetItemRow`** (after `price_unknown`)

```ts
  freq: string
  count: number
```

- [ ] **Step 3: Map them in `rowToBudgetItem`** (after `priceUnknown: row.price_unknown,`)

```ts
    freq: row.freq,
    count: row.count,
```

- [ ] **Step 4: Add to the SELECT in `getBudgetItems`** — append `, freq, count` to the select string.

- [ ] **Step 5: Validate + commit**

```bash
pnpm lint && pnpm build
git add src/lib/trips/budget-item-types.ts src/lib/trips/budget-item-queries.ts
git commit -m "feat(budget): read freq+count on budget items"
```

---

### Task 3: Persist `freq`/`count` on Apply

**Files:**
- Modify: `src/lib/trips/actions.ts` (`SaveBudgetItemInput`, `saveBudgetItems`)

**Interfaces:**
- Consumes: `SaveBudgetItemInput` from the drafter's Apply.
- Produces: `saveBudgetItems` inserts `freq`, `count`.

Note: `saveBudgetItemsForScope` is intentionally left alone — its `.update()` doesn't name these columns (so they survive an edit) and its inserts take the DB defaults.

- [ ] **Step 1: Extend `SaveBudgetItemInput`** (after `priceUnknown?`)

```ts
  freq?: string
  count?: number
```

- [ ] **Step 2: Add to the `rows` shape in `saveBudgetItems`** (after `price_unknown: boolean`)

```ts
    freq: string
    count: number
```

- [ ] **Step 3: Populate in the `rows.push({...})`** (after `price_unknown: it.priceUnknown ?? false,`)

```ts
      freq: it.freq ?? "once",
      count: it.count ?? 1,
```

- [ ] **Step 4: Validate + commit**

```bash
pnpm lint && pnpm build
git add src/lib/trips/actions.ts
git commit -m "feat(budget): persist freq+count from the drafter"
```

---

### Task 4: Drafter data model + quantity resolution

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

**Interfaces:**
- Produces: `resolveQty(bucketId, row)`, `bucketDays(bucketId)`, `rowTotalCents(bucketId, row)`, `rowUnitSuffix(row)`.

- [ ] **Step 1: Add `freq`/`count` to `ItemRow`** (after `whenEnd?`)

```ts
  /** How the value multiplies: once (x1), times (count or a dated span), daily (day-slots). */
  freq?: "once" | "times" | "daily"
  /** The multiplier for freq "times" (ignored when a date range is set). */
  count?: number
```

- [ ] **Step 2: Delete the module-level `rowTotalCents`** (the `function rowTotalCents(catKey...)` block). `spanCount`, `fmtDate`, `rangeLabel` stay module-level.

- [ ] **Step 3: Default `freq`/`count` in `newRow`**

```ts
  function newRow(fields: Partial<ItemRow> = {}): ItemRow {
    return { id: `it-${itemSeq.current++}`, subject: "", when: "", value: "", freq: "once", count: 1, ...fields }
  }
```

- [ ] **Step 4: Add day-slot + quantity helpers inside the component** (just below `newRow`)

```ts
  /** Day-slots for a bucket: the location's dated days, or the whole trip for a
   * trip-wide bucket; falls back to the whole trip when a location has none. */
  function bucketDays(bucketId: string): number {
    const locKey = bucketId.split(":")[1]
    if (!locKey || locKey === "trip") return totalDays
    let n = 0
    for (const d of itineraryDays) if (d.locationId === locKey) n++
    return n || totalDays
  }

  /** The multiplier for a row: once -> 1, times -> a dated span or the count,
   * daily -> day-slots (nights for accommodation, inclusive days otherwise). */
  function resolveQty(bucketId: string, row: ItemRow): number {
    const catKey = bucketId.split(":")[0]
    const freq = row.freq ?? "once"
    if (freq === "daily") {
      const days = bucketDays(bucketId)
      return catKey === "accommodation" ? Math.max(1, days - 1) : Math.max(1, days)
    }
    if (freq === "times") {
      if (row.whenStart && row.whenEnd) return spanCount(catKey, row.whenStart, row.whenEnd)
      return Math.max(1, row.count ?? 1)
    }
    return 1
  }

  /** A row's total in cents: per-unit value times its resolved quantity. */
  function rowTotalCents(bucketId: string, row: ItemRow): number {
    return asCents(row.value) * resolveQty(bucketId, row)
  }

  /** Unit hint shown after the price input. */
  function rowUnitSuffix(row: ItemRow): string {
    const freq = row.freq ?? "once"
    if (freq === "daily") return "/day"
    if (freq === "times") return row.whenStart && row.whenEnd ? "/day" : "each"
    return ""
  }
```

- [ ] **Step 5: Rewrite `savedRows` restore** (divide the stored total back by the resolved quantity; upgrade legacy dated rows whose `freq` is still the default to `times`)

```ts
  function savedRows(): Record<string, Partial<ItemRow>[]> {
    const ids = new Set(locations.map((l) => l.id))
    const fallback = locations[0]?.id ?? "trip"
    const out: Record<string, Partial<ItemRow>[]> = {}
    for (const it of initialItems) {
      if (isBufferSubject(it.subject)) continue
      const catKey = STEP_BY_CATEGORY[it.category]
      if (!catKey) continue
      const locKey = PER_LOCATION.has(catKey)
        ? it.locationId && ids.has(it.locationId)
          ? it.locationId
          : fallback
        : "trip"
      const bucketId = `${catKey}:${locKey}`
      // Pre-how-often rows stored a dated range under the default freq; treat them as times.
      const freq: ItemRow["freq"] =
        it.freq === "times" || it.freq === "daily"
          ? it.freq
          : it.whenStart && it.whenEnd
            ? "times"
            : "once"
      const rowLike: ItemRow = {
        id: "",
        subject: it.subject,
        when: it.whenLabel,
        value: "",
        freq,
        count: it.count || 1,
        whenStart: it.whenStart ?? "",
        whenEnd: it.whenEnd ?? "",
      }
      const qty = resolveQty(bucketId, rowLike)
      const per = qty > 1 ? Math.round(it.amountCents / qty) : it.amountCents
      ;(out[bucketId] ??= []).push({
        subject: it.subject,
        when: it.whenLabel,
        value: it.priceUnknown ? "" : per ? fmt(per) : "",
        freq,
        count: it.count || 1,
        whenStart: it.whenStart ?? "",
        whenEnd: it.whenEnd ?? "",
        estimated: it.estimated,
        sourceUrl: it.sourceUrl,
        priceUnknown: it.priceUnknown,
      })
    }
    return out
  }
```

- [ ] **Step 6: Repoint the three `rowTotalCents` callers to pass `bucketId`**
  - `collectLines`: `const cents = rowTotalCents(bucketId, r)`
  - `subtotalCents`: `for (const r of rows) sum += rowTotalCents(bucketId, r)` (drop the now-unused `catKey` local)
  - `apply`: `const cents = rowTotalCents(bucketId, r)`

- [ ] **Step 7: Persist `freq`/`count` in `apply`'s `items.push({...})`** (after `priceUnknown: r.priceUnknown ?? false,`)

```ts
          freq: r.freq ?? "once",
          count: r.count ?? 1,
```

- [ ] **Step 8: Validate + commit**

```bash
pnpm lint && pnpm build
git add src/app/trips/[slug]/budget-drafter.tsx
git commit -m "feat(budget): quantity model (once/times/daily) in the drafter"
```

---

### Task 5: Drafter UI — the control + review

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

- [ ] **Step 1: Replace `renderRow`'s second line** (the `mt-1.5 flex flex-wrap` block: Note input, the two date inputs, and the price span). New body:

```tsx
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={row.when}
            placeholder="Note (optional)"
            onChange={(e) => patchItem(bucketId, row.id, { when: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
          />

          <div className="inline-flex items-center gap-0.5">
            {(["once", "times", "daily"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => patchItem(bucketId, row.id, { freq: f })}
                disabled={isPending}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                  (row.freq ?? "once") === f
                    ? "border-0 bg-foreground text-background"
                    : "border border-border bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "times" ? "× n" : f}
              </button>
            ))}
          </div>

          {(row.freq ?? "once") === "times" ? (
            <>
              {!(row.whenStart && row.whenEnd) ? (
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  aria-label="Times"
                  value={row.count ?? 1}
                  onChange={(e) =>
                    patchItem(bucketId, row.id, {
                      count: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    })
                  }
                  disabled={isPending}
                  className="t-num w-10 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                />
              ) : null}
              <input
                type="date"
                aria-label="Start date"
                value={row.whenStart ?? ""}
                onChange={(e) => patchItem(bucketId, row.id, { whenStart: e.target.value })}
                disabled={isPending}
                className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
              />
              <input
                type="date"
                aria-label="End date"
                value={row.whenEnd ?? ""}
                min={row.whenStart || undefined}
                onChange={(e) => patchItem(bucketId, row.id, { whenEnd: e.target.value })}
                disabled={isPending}
                className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
              />
            </>
          ) : null}

          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-[12px] text-muted-foreground">€</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.value}
              onChange={(e) => editValue(bucketId, row.id, e.target.value)}
              disabled={isPending}
              className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
            />
            {rowUnitSuffix(row) ? (
              <span className="font-mono text-[9px] text-muted-foreground">{rowUnitSuffix(row)}</span>
            ) : null}
          </span>
        </div>
```

- [ ] **Step 2: Update the review line in `renderReview`** — replace the `const catKey`/`meta`/`ranged` header of the `.map` callback and the `ranged` hint block. New callback head (through `meta`/`multi`):

```tsx
            lines.map(({ bucketId, row, primary }) => {
              const qty = resolveQty(bucketId, row)
              const freq = row.freq ?? "once"
              const qtyLabel =
                freq === "daily"
                  ? "daily"
                  : freq === "times" && !(row.whenStart && row.whenEnd)
                    ? `× ${row.count ?? 1}`
                    : ""
              const meta = [rangeLabel(row), qtyLabel, row.when.trim()].filter(Boolean).join(" · ")
              const multi = qty > 1 && !row.priceUnknown
              return (
```

  And replace the ranged hint (the `{ranged ? (... /day = €... ) : null}` span) with:

```tsx
                    {multi ? (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        × {qty} = €{fmt(rowTotalCents(bucketId, row))}
                      </span>
                    ) : null}
```

- [ ] **Step 3: Validate + commit**

```bash
pnpm lint && pnpm build
git add src/app/trips/[slug]/budget-drafter.tsx
git commit -m "feat(budget): How often control (once/times/daily) on walk rows"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/DECISIONS.md` (one row), `docs/TODO.md` (one entry)

- [ ] **Step 1: Add a DECISIONS row** — the how-often quantity model, range-under-times, Daily-dateless, day-slots source, freq+count columns.
- [ ] **Step 2: Add a TODO entry** — note the pending Supabase paste of `20260716000001_budget_item_freq.sql` and in-app verify.
- [ ] **Step 3: Commit.**

## Self-Review

- **Spec coverage:** Once/×times/Daily ✓ (Task 5); range under ×times ✓; Daily dateless ✓; day-slots ✓ (Task 4 `bucketDays`); nights-vs-days ✓ (`resolveQty`); freq+count columns ✓ (Tasks 1–3); divide-back restore ✓ (Task 4 Step 5); Generate untouched ✓ (no seam changes).
- **Deviations from spec (intentional, simpler):** day-slots computed in the drafter from `itineraryDays` (no `page.tsx`/`budget-tab.tsx` prop threading); scope editor untouched (columns survive its update; inserts default).
- **Type consistency:** `rowTotalCents` takes `bucketId` at every call site (Task 4 Step 6). `resolveQty`/`bucketDays`/`rowUnitSuffix` are component-scoped (need `itineraryDays`/`totalDays`). `BudgetItem.freq: string` (DB text) coerced to the `ItemRow` union in `savedRows`.
