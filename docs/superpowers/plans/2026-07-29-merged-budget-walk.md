# Merged Budget Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two budget walks (Before you go, Plan a budget) with one button and one walk whose first six screens are the before-you-go questions, while keeping the AI `generate` call blind to the pre-trip lines.

**Architecture:** `BudgetDrafter` grows six pre-trip screens in front of its existing category screens, stored in the same `session.items` map under `pretrip:*` bucket keys. Bucket-key prefix is the single discriminator: `collectLines` skips those keys so the AI never sees them, the review sums them into their own section outside the buffer base, and `apply` routes them to `savePreTripItems` while everything else goes to `saveBudgetItems`. `PreTripChecklist` is deleted; its always-visible role is taken over by a `BudgetScopeEditor` in pre-trip mode.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, Supabase (server actions in `src/lib/trips/actions.ts`).

## Global Constraints

- **No tests exist in this repo.** Do not invent a test command. Every task's verification cycle is: reason through the data path, then `pnpm lint`, then `pnpm build`.
- **`pnpm build` clobbers the shared `.next` directory.** A dev server is currently listening on :3000. Stop it before the first build; do not run builds while it runs.
- **No emojis** in code, comments, or strings.
- **Sparse comments.** Comment only where the WHY is non-obvious. Match the surrounding files' density.
- **Dates display day-before-month** (`en-GB`). Not touched by this plan, but do not regress it.
- **Never claim anything behind the UI is "verified".** Report "implemented; build and lint clean; unverified in app".
- Existing five slot labels, verbatim and in this order: `Flights / getting there`, `Travel insurance`, `Docs & fees`, `Medicine / vaccinations`, `Gear & equipment`.
- The pre-trip database category string is exactly `Pre-trip`.

---

### Task 1: Pre-trip step module

Extract the before-you-go questions into their own file as data plus one presentational renderer, so `budget-drafter.tsx` (967 lines) does not grow by another 200.

**Files:**
- Create: `src/app/trips/[slug]/budget-drafter-pretrip.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PRE_TRIP_CATEGORY: "Pre-trip"`
  - `interface PreTripStep { key: string; label: string; addNoun: string; fixedSubject: string | null }`
  - `PRE_TRIP_STEPS: PreTripStep[]` — six entries, keys `pretrip:flights`, `pretrip:insurance`, `pretrip:docs`, `pretrip:medicine`, `pretrip:gear`, `pretrip:extras`
  - `isPreTripKey(key: string): boolean`
  - `PreTripStepBody(props: { step: PreTripStep; rows: PreTripRowLike[]; disabled: boolean; onPatch: (id: string, patch: { subject?: string; when?: string; value?: string }) => void; onAdd: () => void; onRemove: (id: string) => void }): React.JSX.Element`
  - `interface PreTripRowLike { id: string; subject: string; when: string; value: string }` — deliberately a structural subset of `budget-drafter.tsx`'s `ItemRow`, so no import crosses between the two files in either direction.

- [ ] **Step 1: Write the module**

```tsx
"use client"

import * as React from "react"

export const PRE_TRIP_CATEGORY = "Pre-trip"

export interface PreTripStep {
  key: string
  label: string
  addNoun: string
  /** Fixed slots lock the subject to the label; the extras step lets the couple name rows. */
  fixedSubject: string | null
}

export const PRE_TRIP_STEPS: PreTripStep[] = [
  {
    key: "pretrip:flights",
    label: "Flights / getting there",
    addNoun: "flight",
    fixedSubject: "Flights / getting there",
  },
  {
    key: "pretrip:insurance",
    label: "Travel insurance",
    addNoun: "policy",
    fixedSubject: "Travel insurance",
  },
  {
    key: "pretrip:docs",
    label: "Docs & fees",
    addNoun: "doc",
    fixedSubject: "Docs & fees",
  },
  {
    key: "pretrip:medicine",
    label: "Medicine / vaccinations",
    addNoun: "item",
    fixedSubject: "Medicine / vaccinations",
  },
  {
    key: "pretrip:gear",
    label: "Gear & equipment",
    addNoun: "item",
    fixedSubject: "Gear & equipment",
  },
  {
    key: "pretrip:extras",
    label: "Anything else?",
    addNoun: "item",
    fixedSubject: null,
  },
]

export function isPreTripKey(key: string): boolean {
  return key.startsWith("pretrip:")
}

/** The bucket a saved Pre-trip item belongs to, matched on its locked subject;
 * anything else the couple named lands in the extras bucket. */
export function preTripBucketFor(subject: string): string {
  const hit = PRE_TRIP_STEPS.find((s) => s.fixedSubject === subject.trim())
  return hit ? hit.key : "pretrip:extras"
}

/** A drafter row, narrowed to the fields a pre-trip screen touches. */
export interface PreTripRowLike {
  id: string
  subject: string
  when: string
  value: string
}

export function PreTripStepBody({
  step,
  rows,
  disabled,
  onPatch,
  onAdd,
  onRemove,
}: {
  step: PreTripStep
  rows: PreTripRowLike[]
  disabled: boolean
  onPatch: (id: string, patch: { subject?: string; when?: string; value?: string }) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      <div className="mt-2 font-serif text-[15px] italic text-foreground">{step.label}</div>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
            {step.fixedSubject === null ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => onPatch(row.id, { subject: e.target.value })}
                  disabled={disabled}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  disabled={disabled}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ) : null}
            <div
              className={`flex items-center gap-1.5 ${step.fixedSubject === null ? "mt-1.5" : ""}`}
            >
              <input
                type="text"
                value={row.when}
                placeholder="Note (optional)"
                onChange={(e) => onPatch(row.id, { when: e.target.value })}
                disabled={disabled}
                className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
              />
              <span className="inline-flex items-baseline gap-1">
                <span className="font-mono text-[12px] text-muted-foreground">€</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={row.value}
                  onChange={(e) => onPatch(row.id, { value: e.target.value })}
                  disabled={disabled}
                  className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                />
              </span>
              {step.fixedSubject !== null ? (
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  disabled={disabled}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add {step.addNoun}
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean. The new file is not yet imported anywhere, so this only proves it parses and satisfies ESLint.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/budget-drafter-pretrip.tsx"
git commit -m "feat(budget): pre-trip walk steps as a standalone module"
```

---

### Task 2: Prepend the pre-trip screens to the drafter walk

The walk becomes six pre-trip screens, then the category screens, then buffer, then review, on one global counter. `generate` must stay blind to the pre-trip rows and `apply` must write them through their own action.

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

**Interfaces:**
- Consumes: `PRE_TRIP_STEPS`, `PRE_TRIP_CATEGORY`, `isPreTripKey`, `preTripBucketFor`, `PreTripStepBody` from Task 1.
- Produces: no exported surface change. `BudgetDrafterProps` is unchanged — `initialItems` already carries the Pre-trip rows.

- [ ] **Step 1: Add the imports**

At the top of `budget-drafter.tsx`, alongside the existing imports:

```tsx
import { saveBudgetItems, savePreTripItems, type SaveBudgetItemInput } from "@/lib/trips/actions"
import {
  isPreTripKey,
  preTripBucketFor,
  PreTripStepBody,
  PRE_TRIP_CATEGORY,
  PRE_TRIP_STEPS,
} from "./budget-drafter-pretrip"
```

The existing `import { saveBudgetItems, type SaveBudgetItemInput } from "@/lib/trips/actions"` line is replaced by the first line above.

- [ ] **Step 2: Give `ItemRow` a server id**

Pre-trip rows round-trip through `savePreTripItems`, which updates in place by id to preserve paid links. Add one field to the `ItemRow` interface, after `priceUnknown`:

```tsx
  /** Persisted item id, for pre-trip rows that round-tripped from the budget. */
  serverId?: string
```

- [ ] **Step 3: Re-derive the step indices**

Replace:

```tsx
  const bufferIndex = session ? session.steps.length : 0
  const reviewIndex = bufferIndex + 1
```

with:

```tsx
  const preCount = PRE_TRIP_STEPS.length
  const bufferIndex = session ? preCount + session.steps.length : 0
  const reviewIndex = bufferIndex + 1
```

- [ ] **Step 4: Seed the pre-trip buckets**

Add this helper next to `savedRows()`:

```tsx
  /** Saved Pre-trip items -> rows per pre-trip bucket, keeping each item's id so
   * a later save updates it in place (and keeps its paid link). */
  function savedPreTripRows(): Record<string, Partial<ItemRow>[]> {
    const out: Record<string, Partial<ItemRow>[]> = {}
    for (const it of initialItems) {
      if (it.category !== PRE_TRIP_CATEGORY) continue
      const bucket = preTripBucketFor(it.subject)
      ;(out[bucket] ??= []).push({
        serverId: it.id,
        subject: it.subject,
        when: it.whenLabel,
        value: it.amountCents > 0 ? euroInput(it.amountCents) : "",
      })
    }
    return out
  }
```

Then in `seedSession`, after the loop that fills `items` from `steps`, add the pre-trip buckets. Replace:

```tsx
    const items: Record<string, ItemRow[]> = {}
    for (const step of steps) {
      const rows = (seed[step.key] ?? []).map((r) => newRow(r))
      items[step.key] = rows.length > 0 ? rows : [newRow()]
    }
```

with:

```tsx
    const items: Record<string, ItemRow[]> = {}
    for (const step of steps) {
      const rows = (seed[step.key] ?? []).map((r) => newRow(r))
      items[step.key] = rows.length > 0 ? rows : [newRow()]
    }
    // Pre-trip buckets always come from what's saved: there is nothing in the
    // itinerary to seed them from, and Start over must not blank them.
    const pre = savedPreTripRows()
    for (const step of PRE_TRIP_STEPS) {
      const rows = (pre[step.key] ?? []).map((r) =>
        newRow({ subject: step.fixedSubject ?? "", ...r }),
      )
      items[step.key] =
        rows.length > 0
          ? rows
          : step.fixedSubject === null
            ? []
            : [newRow({ subject: step.fixedSubject })]
    }
```

Note the extras bucket starts empty (its screen offers `+ add item`); each fixed slot starts with one blank row, matching today's behaviour.

- [ ] **Step 5: Keep `generate` blind to the pre-trip rows**

In `collectLines`, skip the pre-trip buckets. Replace:

```tsx
    for (const [bucketId, rows] of Object.entries(s.items)) {
      const [stepKey, locKey] = bucketId.split(":")
      const category = CATEGORY_BY_STEP[stepKey]
      if (!category) continue
```

with:

```tsx
    for (const [bucketId, rows] of Object.entries(s.items)) {
      if (isPreTripKey(bucketId)) continue
      const [stepKey, locKey] = bucketId.split(":")
      const category = CATEGORY_BY_STEP[stepKey]
      if (!category) continue
```

`isPreTripKey` is checked first because `CATEGORY_BY_STEP["pretrip"]` is already undefined — the explicit skip states the intent rather than relying on that.

Then make the merge-back preserve them. In `generate`, replace:

```tsx
      setSession((s) => (s ? { ...s, items: filledToItems(r.lines ?? []) } : s))
```

with:

```tsx
      setSession((s) => {
        if (!s) return s
        const kept: Record<string, ItemRow[]> = {}
        for (const [k, v] of Object.entries(s.items)) if (isPreTripKey(k)) kept[k] = v
        return { ...s, items: { ...kept, ...filledToItems(r.lines ?? []) } }
      })
```

`filledToItems` only ever emits `CATEGORY_BY_STEP` buckets, so the two halves cannot collide.

- [ ] **Step 6: Split the subtotals**

Replace `subtotalCents` with a pair. `unknownCount` is left alone: pre-trip rows are never AI-priced, so they can never carry `priceUnknown`, and its scan over them is a no-op.

```tsx
  /** The trip-category subtotal — the base the buffer is a percentage of. */
  function subtotalCents(s: Session): number {
    let sum = 0
    for (const [bucketId, rows] of Object.entries(s.items)) {
      if (isPreTripKey(bucketId)) continue
      for (const r of rows) sum += rowTotalCents(bucketId, r)
    }
    return sum
  }

  /** The before-you-go subtotal. Sits outside the buffer base: flights and
   * insurance are prices you looked up, not estimates needing a cushion. */
  function preTripSubtotalCents(s: Session): number {
    let sum = 0
    for (const step of PRE_TRIP_STEPS) {
      for (const r of s.items[step.key] ?? []) sum += asCents(r.value)
    }
    return sum
  }
```

- [ ] **Step 7: Write both halves on apply**

Replace the whole `apply` function with:

```tsx
  function apply() {
    if (!session || isPending) return
    const items: SaveBudgetItemInput[] = []
    for (const [bucketId, rows] of Object.entries(session.items)) {
      if (isPreTripKey(bucketId)) continue
      const [stepKey, locKey] = bucketId.split(":")
      const category = CATEGORY_BY_STEP[stepKey]
      if (!category) continue
      const locationId = locKey && locKey !== "trip" ? locKey : null
      for (const r of rows) {
        const cents = rowTotalCents(bucketId, r)
        if (r.subject.trim() === "" && cents === 0 && !r.priceUnknown) continue
        items.push({
          category,
          subject: r.subject,
          whenLabel: r.when,
          amountCents: cents,
          locationId,
          whenStart: r.whenStart || null,
          whenEnd: r.whenEnd || null,
          estimated: r.estimated ?? false,
          sourceUrl: r.sourceUrl ?? null,
          priceUnknown: r.priceUnknown ?? false,
          freq: r.freq ?? "once",
          count: r.count ?? 1,
        })
      }
    }
    const buffer = Math.round((subtotalCents(session) * bufferPct) / 100)
    if (buffer > 0) {
      items.push({
        category: "Other",
        subject: `Buffer (${bufferPct}%)`,
        whenLabel: "",
        amountCents: buffer,
        locationId: null,
      })
    }

    const preItems: SaveBudgetItemInput[] = []
    for (const step of PRE_TRIP_STEPS) {
      for (const r of session.items[step.key] ?? []) {
        const cents = asCents(r.value)
        if (cents === 0 || r.subject.trim() === "") continue
        preItems.push({
          id: r.serverId,
          category: PRE_TRIP_CATEGORY,
          subject: r.subject.trim(),
          whenLabel: r.when.trim(),
          amountCents: cents,
          locationId: null,
        })
      }
    }

    startTransition(async () => {
      // Pre-trip first: it updates in place, so paid links survive. The budget
      // save runs second because its delete spares Pre-trip and its planned-total
      // recompute then sees both halves.
      const pre = await savePreTripItems({ tripId, tripSlug, items: preItems })
      if (pre.error) {
        setError(pre.error)
        return
      }
      const r = await saveBudgetItems({ tripId, tripSlug, items })
      if (r.error) {
        setError(r.error)
        return
      }
      setSession(null)
    })
  }
```

- [ ] **Step 8: Route the walk through the new screens**

Replace the render body:

```tsx
        {stepIndex < session.steps.length
          ? renderStep(session.steps[stepIndex])
          : stepIndex === bufferIndex
            ? renderBuffer()
            : renderReview()}
```

with:

```tsx
        {stepIndex < preCount
          ? renderPreTripStep(stepIndex)
          : stepIndex < bufferIndex
            ? renderStep(session.steps[stepIndex - preCount])
            : stepIndex === bufferIndex
              ? renderBuffer()
              : renderReview()}
```

Then update the three places that assume `stepIndex` indexes `session.steps` directly:

`goNext` — the normalize call must map back:

```tsx
  function goNext() {
    if (!session) return
    const catIndex = stepIndex - preCount
    if (catIndex >= 0 && catIndex < session.steps.length) {
      normalizeStep(session.steps[catIndex])
    }
    setStepIndex((i) => i + 1)
  }
```

`renderStep`'s counter — replace:

```tsx
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {session!.steps.length}
          </span>
```

with:

```tsx
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {bufferIndex + 2}
          </span>
```

`bufferIndex + 2` counts every screen through review: `preCount + categories + buffer + review`.

`renderBuffer`'s back button — replace `onClick={() => setStepIndex(session!.steps.length - 1)}` with `onClick={() => setStepIndex(bufferIndex - 1)}`.

- [ ] **Step 9: Add the pre-trip screen renderer**

Add this function inside `BudgetDrafter`, next to `renderStep`:

```tsx
  function renderPreTripStep(i: number) {
    const step = PRE_TRIP_STEPS[i]
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>before you go</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {i + 1} of {bufferIndex + 2}
          </span>
        </div>

        <PreTripStepBody
          step={step}
          rows={session!.items[step.key] ?? []}
          disabled={isPending}
          onPatch={(id, patch) => patchItem(step.key, id, patch)}
          onAdd={() => addItem(step.key, { subject: step.fixedSubject ?? "" })}
          onRemove={(id) => removeItem(step.key, id)}
        />

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
            disabled={i === 0}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => setStepIndex((s) => s + 1)}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              next
            </button>
          </div>
        </div>
      </>
    )
  }
```

`addItem` currently takes only a bucket id; widen it so a fixed slot's added row carries its locked subject:

```tsx
  function addItem(bucketId: string, fields: Partial<ItemRow> = {}) {
    setSession((s) =>
      s
        ? { ...s, items: { ...s.items, [bucketId]: [...(s.items[bucketId] ?? []), newRow(fields)] } }
        : s,
    )
  }
```

Existing callers pass one argument and keep working.

- [ ] **Step 10: Two-section review**

In `renderReview`, replace the line-gathering and the totals block. Replace:

```tsx
    const subtotal = subtotalCents(session!)
    const buffer = Math.round((subtotal * bufferPct) / 100)
    const toPrice = unknownCount(session!)
```

with:

```tsx
    const subtotal = subtotalCents(session!)
    const buffer = Math.round((subtotal * bufferPct) / 100)
    const toPrice = unknownCount(session!)
    const preLines: { key: string; row: ItemRow }[] = []
    for (const step of PRE_TRIP_STEPS) {
      for (const row of session!.items[step.key] ?? []) {
        if (asCents(row.value) === 0 && row.subject.trim() === "") continue
        preLines.push({ key: step.key, row })
      }
    }
    const preSubtotal = preTripSubtotalCents(session!)
```

Then, immediately after the opening `<>` and the header `div`, before `<div className="mt-2 border-t border-rule">`, insert the before-you-go section:

```tsx
        {preLines.length > 0 ? (
          <div className="mt-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Before you go
            </div>
            <div className="mt-1 border-t border-rule">
              {preLines.map(({ key, row }) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="min-w-0">
                    <span className="text-[13px] text-foreground">{row.subject.trim()}</span>
                    {row.when.trim() ? (
                      <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                        {row.when.trim()}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-baseline gap-1">
                      <span className="font-mono text-[12px] text-muted-foreground">€</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        value={row.value}
                        onChange={(e) => patchItem(key, row.id, { value: e.target.value })}
                        disabled={isPending}
                        className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(key, row.id)}
                      disabled={isPending}
                      aria-label="Remove"
                      className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 font-mono text-[11px] text-muted-foreground">
              <span>Before you go</span>
              <span className="t-num">€{fmt(preSubtotal)}</span>
            </div>
            <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Trip
            </div>
          </div>
        ) : null}
```

Finally, fold the pre-trip subtotal into the grand total. Replace:

```tsx
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Total</span>
          <span className="t-num text-[18px] text-foreground">€{fmt(subtotal + buffer)}</span>
        </div>
```

with:

```tsx
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Total</span>
          <span className="t-num text-[18px] text-foreground">
            €{fmt(preSubtotal + subtotal + buffer)}
          </span>
        </div>
```

The buffer row above it already reads `Buffer ({bufferPct}%)` against `subtotal` only — leave it.

- [ ] **Step 11: Reason through the data path, then lint**

Confirm by reading, not by running the app:
1. `collectLines` cannot emit a `pretrip:*` line (Step 5 skips them first).
2. `generate`'s merge keeps `pretrip:*` untouched (Step 5) and `filledToItems` only writes `CATEGORY_BY_STEP` buckets, so no key collides.
3. `apply` sends `preItems` with `category: "Pre-trip"` and everything else with a non-Pre-trip category, and `saveBudgetItems`' delete carries `.neq("category", "Pre-trip")` (`actions.ts:2448`).
4. `bufferIndex + 2` equals `preCount + session.steps.length + 2` — every screen through review.

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add "src/app/trips/[slug]/budget-drafter.tsx"
git commit -m "feat(budget): before-you-go questions open the budget walk"
```

---

### Task 3: Pre-trip mode for the always-visible scope editor

The breakdown under the button gets a Before-you-go scope, editable like any location. Its save must route to `savePreTripItems` (in-place, preserves paid links), not `saveBudgetItemsForScope` (whose queries deliberately exclude `Pre-trip`).

**Files:**
- Modify: `src/app/trips/[slug]/budget-scope-editor.tsx`

**Interfaces:**
- Consumes: `PRE_TRIP_CATEGORY` from Task 1.
- Produces: `BudgetScopeEditor` gains one optional prop, `preTrip?: boolean`. Default false leaves every existing call site behaving exactly as before.

- [ ] **Step 1: Import the action and the category constant**

Replace the `@/lib/trips/actions` import block with one that adds `savePreTripItems`:

```tsx
import {
  addExpenseCategory,
  deleteBudgetItem,
  payBudgetItem,
  saveBudgetItemsForScope,
  savePreTripItems,
  unpayBudgetItem,
} from "@/lib/trips/actions"
```

and add, below the other local imports:

```tsx
import { PRE_TRIP_CATEGORY } from "./budget-drafter-pretrip"
```

- [ ] **Step 2: Add the prop**

In the props object type, after `spentByCategory`:

```tsx
  /** Pre-trip mode: rows are locked to the Pre-trip category, the category
   * picker is hidden, and saves route to savePreTripItems so paid links live. */
  preTrip?: boolean
```

and in the destructuring parameter list, after `spentByCategory,`:

```tsx
  preTrip = false,
```

- [ ] **Step 3: Route the save**

Replace `buildPayload` and `save` with:

```tsx
  function buildPayload() {
    return rows
      .filter((r) => r.subject.trim() !== "" || asCents(r.value) > 0)
      .map((r) => ({
        id: r.serverId ?? undefined,
        category: preTrip ? PRE_TRIP_CATEGORY : r.category,
        subject: r.subject,
        whenLabel: "",
        amountCents: asCents(r.value),
        locationId,
        whenStart: withDates && r.whenStart ? r.whenStart : null,
        whenEnd: withDates && r.whenEnd ? r.whenEnd : null,
        estimated: r.estimated,
        sourceUrl: r.sourceUrl,
        priceUnknown: r.priceUnknown,
      }))
  }

  /** One save path for both modes; pre-trip has its own action because
   * saveBudgetItemsForScope excludes the Pre-trip category by design. */
  function persist() {
    const items = buildPayload()
    return preTrip
      ? savePreTripItems({ tripId, tripSlug, items })
      : saveBudgetItemsForScope({ tripId, tripSlug, locationId, items })
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await persist()
      if (res.error) setError(res.error)
    })
  }
```

Then in `pay`, replace the inline `saveBudgetItemsForScope({...})` call with `persist()`:

```tsx
      const saveRes = await persist()
```

(The `items: buildPayload()` argument object goes away with it.)

- [ ] **Step 4: Hide the category picker in pre-trip mode**

Replace the picker branch's condition. Currently:

```tsx
            {newCat !== null ? (
```

becomes:

```tsx
            {preTrip ? (
              <span />
            ) : newCat !== null ? (
```

The `<span />` holds the flex row's `justify-between` so the `save` button stays right-aligned.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: clean. No call site passes `preTrip` yet, so behaviour is unchanged.

- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/budget-scope-editor.tsx"
git commit -m "feat(budget): pre-trip mode for the scope editor"
```

---

### Task 4: One card, one button

Fold the Before-you-go card into Plan a budget and delete the old component.

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx:27` (import), `:145-159` (the card), `:237-334` (`PlannedBudget`)
- Delete: `src/app/trips/[slug]/pre-trip-checklist.tsx`

**Interfaces:**
- Consumes: `BudgetScopeEditor`'s `preTrip` prop from Task 3.
- Produces: nothing new. `BudgetTabProps` is unchanged.

- [ ] **Step 1: Drop the import and the card**

Remove line 27:

```tsx
import { PreTripChecklist } from "./pre-trip-checklist"
```

and remove the whole Before-you-go block (`{/* Before you go */}` through its closing `</div>`, lines 145-159).

- [ ] **Step 2: Pass the pre-trip items into `PlannedBudget`**

`PlannedBudget` already receives `budgetItems`, so no prop change is needed. Inside it, add the pre-trip slice next to the existing `tripWide` derivation:

```tsx
  const preTripItems = budgetItems.filter((it) => it.category === "Pre-trip")
```

The existing `tripWide` filter already carries `it.category !== "Pre-trip"`, so nothing double-lists.

- [ ] **Step 3: Render the Before-you-go scope first**

In `PlannedBudget`'s returned JSX, immediately after the opening `<div className="border-t border-border px-5 pt-4 pb-5">` and before `{locations.map(...)}`:

```tsx
      <BudgetScopeEditor
        key={scopeKey("pretrip", preTripItems)}
        tripId={tripId}
        tripSlug={tripSlug}
        locationId={null}
        items={preTripItems}
        withDates={false}
        defaultCategory="Pre-trip"
        label="Before you go"
        preTrip
      />
```

No `categories` prop (pre-trip has one fixed category) and no `spentByCategory` — a paid pre-trip item logs a location-less expense, which `spentForScope(null)` already attributes to the Trip-wide scope; passing it here too would show the same spend twice.

- [ ] **Step 4: Delete the old component**

```bash
git rm "src/app/trips/[slug]/pre-trip-checklist.tsx"
```

- [ ] **Step 5: Verify nothing still references it**

Run: `grep -rn "PreTripChecklist\|pre-trip-checklist" src/`
Expected: no output.

- [ ] **Step 6: Lint, then build**

Stop the dev server first — `pnpm build` writes the same `.next` directory it serves from, and building underneath a running server leaves the app unstyled.

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: compiles, types check, no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): merge before-you-go into the plan-a-budget card"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Add the decision row**

Append to `docs/DECISIONS.md`, matching the existing table's column shape:

> Before-you-go and the budget walk are one button and one walk, pre-trip questions first — but the AI `generate` call never sees the pre-trip lines, and the buffer % applies only to the trip subtotal. Flights and insurance are prices the couple looks up, not estimates needing a cushion.

- [ ] **Step 2: Update the TODO**

Add under the current phase in `docs/TODO.md`, marked *implemented* (not verified):

> - [x] Merged budget walk — one "Plan a budget" button, before-you-go questions first, generate still split. *Implemented; build and lint clean; unverified in app.*

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the merged budget walk"
```

---

## Success criteria

Carried verbatim from the spec.

**Verified by Claude**

1. `pnpm build` passes and `pnpm lint` is clean.
2. `src/app/trips/[slug]/pre-trip-checklist.tsx` no longer exists and nothing imports it.
3. `budget-tab.tsx` renders exactly one button that opens a budget walk.
4. `collectLines()` returns no line whose bucket id starts with `pretrip:`.
5. `filledToItems()` applied to a generate result leaves the `pretrip:*` buckets of the prior session identical.
6. The review's buffer figure equals `round(tripSubtotal × pct / 100)` where `tripSubtotal` excludes every `pretrip:*` row.
7. `apply` issues `savePreTripItems` before `saveBudgetItems`, and the items passed to `saveBudgetItems` contain no `Pre-trip` category.
8. The Before-you-go scope editor's save path reaches `savePreTripItems` with `category: "Pre-trip"` on every row.

**Verified by the user in-app**

1. The budget tab shows one "Plan a budget" card, no separate "Before you go" card.
2. Opening the walk shows Flights as step 1, counter reads `step 1 of M` covering the whole walk.
3. Walking past step 6 lands on the first location category step; `back` walks back into the pre-trip steps.
4. A typed flight price survives `generate` unchanged and carries no `est.` mark.
5. Review shows a Before-you-go section and a Trip section with separate subtotals; the buffer line names only the trip subtotal.
6. After `apply` and reload, both halves persist and the planned total matches the review's grand total.
7. A pre-trip line already marked paid is still paid after an `apply` that did not touch it.
8. The breakdown below the button shows an editable Before-you-go section first; editing an amount there and saving persists it.
9. `Start over` clears the category rows back to itinerary seeds and leaves the pre-trip amounts in place.
10. Checked at a phone viewport.
