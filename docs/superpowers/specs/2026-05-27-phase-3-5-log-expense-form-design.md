# Phase 3.5 — `+ log expense` form

**Status:** spec, awaiting plan.
**Phase:** 3.5 — Basic CRUD (task 2 of 3).
**Predecessor:** `+ add packing item` (shipped 2026-05-27) — same inline-expansion + Server Action pattern.

## Problem

The Budget tab on `/trips/[slug]?tab=budget` renders a live ledger of `expenses` rows, the settle-up card, and a footer button `+ log expense`. The button is currently a stub: no `onClick`, no form, no insert path. Without it, the only way to add an expense is to hand-write SQL — which means the Budget tab is not field-testable for the Lombok trip (Jun 12).

The `expenses` schema and RLS already exist from Phase 3 task 7. We just need a form that inserts a row.

## Goals

- A signed-in workspace member can add a non-settlement expense from the Budget tab on a phone in a few taps.
- The new row appears in the ledger and updates the budget total without a manual reload.
- The form supports rattling off several expenses in a row (post-dinner, post-day) without re-tapping the trigger.

## Non-goals

- Edit or delete an existing expense.
- Currency picker (locked to `EUR`).
- Receipt photo / attachment.
- Uneven splits or per-person share weighting.
- Planned-budget editing (still hard-coded in `fixtures.ts`).
- Recurring expenses.
- Real-time Supabase channel for expenses (the Server Action's `revalidatePath` + existing `RefreshOnVisible` cover the cross-device case).

## UX

### Trigger

The existing footer button `+ log expense >` at the foot of `budget-tab.tsx` becomes an inline-expanding form. Collapsed state is byte-for-byte the current `LogExpenseCta`. Tapping it expands the row in place — no modal, no sheet, no portal.

### Expanded form (mobile-first, ~390px)

```
────────────────────
Title  [_________________________]
€  [______]   Day [Jun 13      ▾]
Category [Food ▾]  Paid [ M | G ]
                 [ cancel ]  [ add expense ]
────────────────────
```

- **Title** — text input, autofocused on expand, placeholder `Add an expense…`, required.
- **Amount** — `inputMode="decimal"`, prefixed `€` glyph, required, `> 0`. Accepts e.g. `12.50`, `12`, `12.5`. Parse via `Number(value)` then `Math.round(value * 100)`.
- **Day** — native `<select>` populated with each date in the trip's range plus a leading `— no day` option. Default = today's date if inside `[startDate, endDate]`, else `startDate`. Each option labelled `Jun 12`, `Jun 13`, …
- **Category** — native `<select>` with the fixed list **Surf / Dive / Trek / Food / Transit / Lodging / Other**. Default `Food`. Order chosen to mirror `CATEGORY_TONE` in `budget-tab.tsx`; `Lodging` and `Other` are additions — `Lodging` maps to tone `"sand"`, `Other` to `"ink"`.
- **Paid by** — two-pill toggle showing each member's initial styled with their `MemberToneEntry.tone`. Tap to switch. Defaults to the current user. For workspaces with >2 members the toggle degrades to a native `<select>` (data model supports it; UI already has both fallbacks elsewhere).

### States

- **Empty title or non-positive amount** → submit disabled.
- **In-flight (pending)** → inputs disabled, submit shows `…`.
- **Server error** → inline `font-mono text-[10px] text-clay` row beneath the form, same shape as `AddItemRow`'s error line.
- **Success** → title and amount inputs clear, category / paid_by / day remain, focus returns to title. Form stays expanded.
- **Esc key** or `×` button → collapse back to the `+ log expense >` button, clear inputs.

## Architecture

### File layout

| File | Change |
| --- | --- |
| `src/lib/trips/actions.ts` | Add `logExpense(input)` Server Action. |
| `src/app/trips/[slug]/log-expense-row.tsx` | New `"use client"` component — the expanding form. |
| `src/app/trips/[slug]/budget-tab.tsx` | Replace the stub `LogExpenseCta` render with `<LogExpenseRow …>`, passing the props it needs. Budget tab stays a Server Component. |
| `src/app/trips/[slug]/page.tsx` | Pass `startDate` / `endDate` / current user id / member tones into `BudgetTab` so the row has everything it needs. |
| `src/lib/trips/expense-types.ts` | Export `EXPENSE_CATEGORIES` (the fixed list) + `EXPENSE_CATEGORY_DEFAULT`. Used by both the form and the ledger's tone map. |

### Server Action

`src/lib/trips/actions.ts`:

```ts
export interface LogExpenseInput {
  tripId: string
  tripSlug: string
  title: string
  amount: string      // "12.50" — raw input string
  category: string    // one of EXPENSE_CATEGORIES
  paidBy: string      // workspace member uuid
  dayDate: string | null  // "YYYY-MM-DD" or null
}

export interface LogExpenseResult {
  error?: string
}

export async function logExpense(
  input: LogExpenseInput,
): Promise<LogExpenseResult>
```

Validation (server-side, mirroring schema + RLS):

1. `title.trim()` non-empty.
2. `amount` parses to a positive finite number; cents = `Math.round(amount * 100)`, must be `> 0` and `< 2_147_483_647` (int4 ceiling).
3. `category` ∈ `EXPENSE_CATEGORIES`.
4. `paidBy` is a workspace member (RLS will check; we don't pre-query — trust the RLS policy on `expenses_insert`).
5. `dayDate` is either `null` or a `YYYY-MM-DD` string. We don't validate it falls inside `[startDate, endDate]` — the UI restricts the options, and the schema's `day_date` column is unconstrained-by-design (people log post-trip too).
6. `auth.getUser()` must succeed — we don't pass user id from the client; the action reads it from the session if it ever needs to.

Insert payload:

```ts
{
  trip_id: tripId,
  title: trimmedTitle,
  amount_cents: cents,
  currency: 'EUR',
  paid_by: paidBy,
  category,
  day_date: dayDate,
  is_settlement: false,
}
```

On success: `revalidatePath('/trips/' + tripSlug)` then return `{}`. On error: return `{ error: error.message }`. We do **not** throw — the form is wired to `useTransition`, not `<form action={…}>`, because we need fine-grained pending/error states and to keep the form expanded.

### Client form

`src/app/trips/[slug]/log-expense-row.tsx`:

```ts
"use client"

export interface LogExpenseRowProps {
  tripId: string
  tripSlug: string
  startDate: string | null
  endDate: string | null
  currentUserId: string
  members: Record<string, MemberToneEntry>
}
```

Internally:

- `React.useState` for `expanded`, `title`, `amount`, `category`, `paidBy`, `dayDate`, `error`.
- `React.useTransition` for `isPending`.
- `React.useRef<HTMLInputElement>` on the title input for focus on expand + after-submit refocus.
- Day options derived from `enumerateDays(startDate, endDate)` — a small pure helper co-located in this file (not exported; the only consumer is this component). Returns `[{ value: '2026-06-12', label: 'Jun 12' }, …]`.
- Submit handler:
  ```ts
  startTransition(async () => {
    const result = await logExpense({ ... })
    if (result.error) { setError(result.error); return }
    setTitle("")
    setAmount("")
    setError(null)
    inputRef.current?.focus()
  })
  ```

### Budget tab wiring

`budget-tab.tsx`:

- Delete the private `LogExpenseCta` function.
- Add `currentUserId`, `startDate`, `endDate` to `BudgetTabProps`.
- Replace the `<LogExpenseCta />` render with:
  ```tsx
  <LogExpenseRow
    tripId={tripId}
    tripSlug={tripSlug}
    startDate={startDate}
    endDate={endDate}
    currentUserId={currentUserId}
    members={members}
  />
  ```

`page.tsx` passes the new props.

### Shared category list

`src/lib/trips/expense-types.ts` gains:

```ts
export const EXPENSE_CATEGORIES = [
  'Surf', 'Dive', 'Trek', 'Food', 'Transit', 'Lodging', 'Other',
] as const
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]
export const EXPENSE_CATEGORY_DEFAULT: ExpenseCategory = 'Food'
```

`budget-tab.tsx`'s existing `CATEGORY_TONE` map is extended:

```ts
const CATEGORY_TONE: Record<string, MonoBadgeTone> = {
  Surf: 'sea',
  Dive: 'sea',
  Trek: 'moss',
  Food: 'clay',
  Transit: 'ink',
  Lodging: 'sand',
  Settlement: 'ink',
  Other: 'ink',
}
```

## Validation flow

```
Client (LogExpenseRow)            Server (logExpense)         Postgres
─────────────────────────         ─────────────────────       ─────────────
title.trim() != ""           →    re-check                    NOT NULL + length check
Number(amount) > 0           →    Math.round(*100) > 0        check (amount_cents > 0)
category in EXPENSE_…        →    in EXPENSE_…                NOT NULL + length check
paidBy in members            →    (trust RLS)                 expenses_insert policy
dayDate in day options       →    null or YYYY-MM-DD          date col
                                  auth.getUser()              RLS: is_trip_workspace_member
                                  insert                      ─────→ row
                                  revalidatePath              ─────→ rerender
```

## Acceptance checklist

- [ ] `pnpm build` and `pnpm lint` clean.
- [ ] From `/trips/lombok?tab=budget` on a phone viewport (390px), tapping `+ log expense` expands the form in place; the title input is focused.
- [ ] Submitting a valid expense (`Title: Padang Padang`, `€ 14.00`, `Day: Jun 12`, `Category: Food`, `Paid: M`) inserts a row, the ledger gains a new top entry, the total updates, and the form clears `title`/`amount` while keeping the rest.
- [ ] Submitting an empty title or `€ 0` is blocked client-side (submit button disabled).
- [ ] Pressing `Esc` while the form is expanded collapses it back to the button.
- [ ] An expense logged on phone A is visible to phone B after backgrounding and re-focusing phone B (covered by the existing `RefreshOnVisible`).
- [ ] No regression on settle-up, ledger, split breakdown, or progress bar.

## Decisions to record

If shipped, add a `DECISIONS.md` row noting:
- **Why `useTransition` + return value, not `<form action={settleUp.bind(…)}>`.** We need to keep the form expanded after a success and surface inline errors — pure form-action posts always navigate/refresh and don't give us the success branch.
- **Why a fixed category list at this phase.** Keeps the ledger's `MonoBadge` tones predictable; flexible categories are a Phase 4+ concern once we have a real budget breakdown by category.
