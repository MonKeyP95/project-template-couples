# `+ log expense` Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub `+ log expense` button at the foot of `/trips/[slug]?tab=budget` with an inline-expanding form that inserts a non-settlement row into `expenses` and refreshes the ledger via `revalidatePath`.

**Architecture:** A new `"use client"` component `LogExpenseRow` owns the expansion state and form inputs. It calls a new Server Action `logExpense` which validates, inserts, and `revalidatePath`s `/trips/[slug]`. The Budget tab stays a Server Component; the page passes `startDate`, `endDate`, and `currentUserId` down. No schema migration — `expenses` already has every column.

**Tech Stack:** Next.js 16 App Router, React 19 (`useState` + `useTransition` + `useRef`), Server Actions, `@supabase/ssr`, Tailwind v4. Spec: `docs/superpowers/specs/2026-05-27-phase-3-5-log-expense-form-design.md`.

**Validation approach (this codebase):** there is no test runner yet. Each task is validated with `pnpm lint` + `pnpm build` and finishes with a manual phone-viewport walkthrough at Task 6. Matches how `+ add packing item` shipped on 2026-05-27.

---

### Task 1: Shared category constants

**Files:**
- Modify: `src/lib/trips/expense-types.ts`

- [ ] **Step 1: Add the category list, type, and default**

Append to `src/lib/trips/expense-types.ts`:

```ts
export const EXPENSE_CATEGORIES = [
  "Surf",
  "Dive",
  "Trek",
  "Food",
  "Transit",
  "Lodging",
  "Other",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_DEFAULT: ExpenseCategory = "Food"
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors (this is a pure addition).

- [ ] **Step 3: Type-check via build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet; this just confirms the file still parses.)

---

### Task 2: `logExpense` Server Action

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add types and the action**

Append to `src/lib/trips/actions.ts` (after `addPackingItem`, before `settleUp`):

```ts
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/trips/expense-types"

export interface LogExpenseInput {
  tripId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
}

export interface LogExpenseResult {
  error?: string
}

const MAX_AMOUNT_CENTS = 2_147_483_647

/**
 * Inserts a non-settlement expense row. Returns `{ error }` rather than
 * throwing so the client form can stay expanded and surface the error inline.
 */
export async function logExpense(
  input: LogExpenseInput,
): Promise<LogExpenseResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }

  const amountNum = Number(input.amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { error: "Amount must be greater than zero." }
  }
  const cents = Math.round(amountNum * 100)
  if (cents <= 0 || cents >= MAX_AMOUNT_CENTS) {
    return { error: "Amount out of range." }
  }

  if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
    return { error: "Invalid category." }
  }

  if (!input.paidBy) return { error: "Payer required." }

  if (input.dayDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dayDate)) {
    return { error: "Invalid day." }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("expenses").insert({
    trip_id: input.tripId,
    title,
    amount_cents: cents,
    currency: "EUR",
    paid_by: input.paidBy,
    category: input.category,
    day_date: input.dayDate,
    is_settlement: false,
  })

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

The `createClient` and `revalidatePath` imports already exist at the top of the file.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Type-check via build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet — guards against import path / TS errors before wiring the UI.)

---

### Task 3: `LogExpenseRow` client component

**Files:**
- Create: `src/app/trips/[slug]/log-expense-row.tsx`

- [ ] **Step 1: Create the file**

Write the full contents:

```tsx
"use client"

import * as React from "react"

import { logExpense } from "@/lib/trips/actions"
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DEFAULT,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"

import type { MemberToneEntry } from "./packing-tab"

export interface LogExpenseRowProps {
  tripId: string
  tripSlug: string
  startDate: string | null
  endDate: string | null
  currentUserId: string
  members: Record<string, MemberToneEntry>
}

interface DayOption {
  value: string
  label: string
}

const SHORT_MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function enumerateDays(
  startDate: string | null,
  endDate: string | null,
): DayOption[] {
  if (!startDate || !endDate) return []
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  if (end < start) return []
  const days: DayOption[] = []
  for (
    let d = new Date(start);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(d.getUTCDate()).padStart(2, "0")
    days.push({
      value: `${yyyy}-${mm}-${dd}`,
      label: SHORT_MONTH_DAY.format(d),
    })
  }
  return days
}

function defaultDay(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const todayIso = new Date().toISOString().slice(0, 10)
  if (todayIso >= startDate && todayIso <= endDate) return todayIso
  return startDate
}

export function LogExpenseRow({
  tripId,
  tripSlug,
  startDate,
  endDate,
  currentUserId,
  members,
}: LogExpenseRowProps) {
  const dayOptions = React.useMemo(
    () => enumerateDays(startDate, endDate),
    [startDate, endDate],
  )
  const initialDay = React.useMemo(
    () => defaultDay(startDate, endDate),
    [startDate, endDate],
  )

  const [expanded, setExpanded] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState<ExpenseCategory>(
    EXPENSE_CATEGORY_DEFAULT,
  )
  const [paidBy, setPaidBy] = React.useState<string>(currentUserId)
  const [dayDate, setDayDate] = React.useState<string | null>(initialDay)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const titleRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) titleRef.current?.focus()
  }, [expanded])

  function collapse() {
    setExpanded(false)
    setTitle("")
    setAmount("")
    setCategory(EXPENSE_CATEGORY_DEFAULT)
    setPaidBy(currentUserId)
    setDayDate(initialDay)
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const trimmedTitle = title.trim()
    const amountNum = Number(amount)
    if (!trimmedTitle) return
    if (!Number.isFinite(amountNum) || amountNum <= 0) return

    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: trimmedTitle,
        amount,
        category,
        paidBy,
        dayDate,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setTitle("")
      setAmount("")
      setError(null)
      titleRef.current?.focus()
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between border-0 border-t border-border bg-card px-5 py-4 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          + log expense
        </span>
        <span aria-hidden className="font-mono text-[14px] text-muted-foreground">
          ›
        </span>
      </button>
    )
  }

  const memberEntries = Object.entries(members)
  const usePillToggle = memberEntries.length === 2
  const canSubmit =
    title.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") collapse()
      }}
      className="border-t border-border bg-card px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          log expense
        </span>
        <button
          type="button"
          onClick={collapse}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add an expense…"
        disabled={isPending}
        className="w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Amount
          </span>
          <div className="mt-1 flex items-baseline gap-1.5 border-b border-rule pb-1 focus-within:border-clay">
            <span className="font-mono text-[14px] text-muted-foreground">€</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={isPending}
              className="t-num w-full border-0 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
          </div>
        </label>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Day
          </span>
          <select
            value={dayDate ?? ""}
            onChange={(e) =>
              setDayDate(e.target.value === "" ? null : e.target.value)
            }
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            <option value="">— no day</option>
            {dayOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Paid by
          </span>
          {usePillToggle ? (
            <div className="mt-1 inline-flex rounded-full border border-border bg-background p-0.5">
              {memberEntries.map(([userId, m]) => {
                const active = userId === paidBy
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => setPaidBy(userId)}
                    disabled={isPending}
                    aria-pressed={active}
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? m.tone === "sea"
                          ? "bg-sea text-background"
                          : "bg-clay text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.initial}
                  </button>
                )
              })}
            </div>
          ) : (
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              disabled={isPending}
              className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            >
              {memberEntries.map(([userId, m]) => (
                <option key={userId} value={userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={collapse}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "add expense"}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors. (If lint complains about unused imports — the only import we add is `MemberToneEntry` from `./packing-tab`; double-check the type-only `import type` form so the bundler doesn't pull the client-component file in.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet — confirms tree-shaking / type errors are fine before wiring.)

---

### Task 4: Wire `LogExpenseRow` into `budget-tab.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Extend `CATEGORY_TONE` and add `currentUserId`/`startDate`/`endDate` props**

Replace the top of `budget-tab.tsx` (imports + `CATEGORY_TONE` block + `BudgetTabProps`) so it reads:

```tsx
import {
  Avatar,
  Bar,
  Label,
  MonoBadge,
  type MonoBadgeTone,
  TopoBg,
} from "@/components/together"
import { settleUp } from "@/lib/trips/actions"
import type { BudgetSummary, Expense } from "@/lib/trips/expense-types"

import { LogExpenseRow } from "./log-expense-row"
import type { MemberToneEntry } from "./packing-tab"

const CATEGORY_TONE: Record<string, MonoBadgeTone> = {
  Surf: "sea",
  Dive: "sea",
  Trek: "moss",
  Food: "clay",
  Transit: "ink",
  Lodging: "sand",
  Settlement: "ink",
  Other: "ink",
}
```

Notes:
- The `Chevron` import is no longer used (the stub `LogExpenseCta` is being deleted); remove it from the import list to keep lint happy.
- Add `Lodging` and `Other` keys to `CATEGORY_TONE` so the new categories render with the right tone in the ledger.

Update `BudgetTabProps`:

```tsx
export interface BudgetTabProps {
  tripId: string
  tripSlug: string
  tripName: string
  expenses: Expense[]
  summary: BudgetSummary
  members: Record<string, MemberToneEntry>
  plannedBudgetCents: number
  startDate: string | null
  endDate: string | null
  currentUserId: string
}
```

Update the destructure inside `BudgetTab(...)`:

```tsx
export function BudgetTab({
  tripId,
  tripSlug,
  tripName,
  expenses,
  summary,
  members,
  plannedBudgetCents,
  startDate,
  endDate,
  currentUserId,
}: BudgetTabProps) {
```

- [ ] **Step 2: Replace the stub footer with the real form row**

In the `BudgetTab` JSX, replace `<LogExpenseCta />` with:

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

- [ ] **Step 3: Delete the now-unused `LogExpenseCta` function**

Remove the entire `function LogExpenseCta() { ... }` block at the bottom of the file.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors. If lint flags unused `Chevron`, remove it from the import list — Step 1 already did that, but double-check.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build fails with `Property 'startDate' is missing in type ...` on the `<BudgetTab ... />` call site in `page.tsx`. This is expected — fixed in Task 5.

---

### Task 5: Pass new props from `page.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Pull current user id out of the existing auth call**

The page already calls `supabase.auth.getUser()` and stores it in `userData`. Just below the existing `if (!userData.user) redirect(...)`, the user id is reachable as `userData.user.id`.

- [ ] **Step 2: Pass the three new props into `<BudgetTab>`**

Replace the existing `BudgetTab` call:

```tsx
<BudgetTab
  tripId={header.id}
  tripSlug={header.slug}
  tripName={header.name}
  expenses={expenses}
  summary={budgetSummary}
  members={memberTones}
  plannedBudgetCents={detail?.plannedBudgetCents ?? 0}
  startDate={header.startDate}
  endDate={header.endDate}
  currentUserId={userData.user.id}
/>
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build succeeds end-to-end.

---

### Task 6: Manual phone-viewport walkthrough

**Files:** none — runtime verification only.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Expected: server up on http://localhost:3000.

- [ ] **Step 2: Open `/trips/lombok?tab=budget` in a 390px viewport**

DevTools → device toolbar → iPhone 14 (or any 390-width preset). Sign in if redirected. Confirm the existing budget tab still renders (header, settle-up, split breakdown, ledger).

- [ ] **Step 3: Walk the acceptance checklist**

For each, observe and confirm:

- Tap `+ log expense` → form expands in place; title input is focused.
- Type `Padang Padang`, amount `14`, day `Jun 12`, category `Food`, paid `M` (or whichever initial maps to your current user) → tap `add expense`.
- Within a beat: form clears `title` and `amount` but keeps `Food` / `M` / `Jun 12`; the new row appears at the top of the ledger; the total updates; the planned-budget progress bar advances.
- Try submitting with the title empty → submit button stays disabled (no network call).
- Try submitting amount `0` → submit stays disabled.
- Press `Esc` while expanded → form collapses to the `+ log expense >` button.
- Re-expand, tap the other member's pill, log a `€ 8.50` Transit on day `Jun 13` → settle-up card flips to show the non-zero balance (and updates which member owes which).
- Tap `settle` → balance returns to `All square.` (regression check on settle-up).

- [ ] **Step 4: Type-safety + lint final pass**

Stop the dev server. Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 5: Briefly verify the partner sync path**

Open a second incognito window signed in as the other workspace member, leave it on `/trips/lombok?tab=budget`, background it (switch tabs), then back in the first window add another expense, then re-focus the second window. `RefreshOnVisible` should re-fetch and the new row should appear. (Skip this step if the second account isn't readily available — it's covered by the existing mechanism, not by this task's code.)

---

### Task 7: Update TODO + DECISIONS, commit

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Check off TODO item 2**

In `docs/TODO.md`, change the line for Phase 3.5 task 2 from `[ ]` to `[x]` and append a one-line "Done YYYY-MM-DD" annotation summarizing what shipped — same shape as the task-1 annotation already there.

Suggested annotation (adapt to the actual ship date):

> **2. `+ log expense` (form)** — Done 2026-05-27. New Server Action `logExpense(input)` in `src/lib/trips/actions.ts` — trims title, parses amount→cents, validates category against `EXPENSE_CATEGORIES`, inserts non-settlement row, `revalidatePath`s the trip page. New `"use client"` component `LogExpenseRow` (`src/app/trips/[slug]/log-expense-row.tsx`) replaces the stub `LogExpenseCta` footer in `budget-tab.tsx`: inline-expanding form with title, amount, day-of-trip select, category select, and a two-pill paid-by toggle (degrading to `<select>` for >2-member workspaces). Submit clears title+amount but keeps category/paid/day for batch entry; Esc collapses. Server Action's `revalidatePath` updates the ledger and total in-place; no Realtime channel — `RefreshOnVisible` covers the cross-device case. Build + lint clean.

- [ ] **Step 2: Add a DECISIONS row**

Append a row to `docs/DECISIONS.md` in the existing table format. Wording:

> `useTransition` + return-value Server Action for `+ log expense` rather than `<form action={…}>` because the form must stay expanded after success (to support batch entry) and surface inline server errors — a plain form-action submit always navigates/refreshes and offers no success branch. `settleUp` keeps its `<form action>` shape because its UX is different (one-shot, page can refresh).

- [ ] **Step 3: Stage and commit**

Run:

```bash
git add src/lib/trips/expense-types.ts src/lib/trips/actions.ts src/app/trips/[slug]/log-expense-row.tsx src/app/trips/[slug]/budget-tab.tsx src/app/trips/[slug]/page.tsx docs/TODO.md docs/DECISIONS.md
```

Then create the commit (HEREDOC so the multi-line message is preserved):

```bash
git commit -m "$(cat <<'EOF'
feat(budget): inline + log expense form

Replaces the stub footer button with an inline-expanding form that
inserts non-settlement rows into expenses. Server Action validates +
revalidatePaths the trip page; no Realtime channel (RefreshOnVisible
covers cross-device sync). Fixed category list extends CATEGORY_TONE
with Lodging (sand) and Other (ink). Phase 3.5 task 2 of 3.
EOF
)"
```

- [ ] **Step 4: Verify**

Run: `git status` — expected clean. Run: `git log -1 --stat` — expected the commit lists the 7 files above.

---

## Self-review

**Spec coverage:**
- Trigger + inline expand pattern → Task 3 (button + form JSX) + Task 4 (wire-in).
- Title, amount, day, category, paid-by field behavior → Task 3 form JSX.
- States (disabled / pending / error / success / Esc) → Task 3 `canSubmit`, `isPending`, `error` line, `collapse()` on Esc.
- `logExpense` action signature, validation, RLS-trust, `revalidatePath` → Task 2.
- `EXPENSE_CATEGORIES` + default → Task 1.
- `CATEGORY_TONE` extended with `Lodging` + `Other` → Task 4 Step 1.
- File layout matches the spec's table.
- `LogExpenseCta` deletion → Task 4 Step 3.
- New `BudgetTabProps` (`startDate`, `endDate`, `currentUserId`) → Task 4 Step 1.
- Page-level prop wiring → Task 5.
- Acceptance checklist mapped onto Task 6 walkthrough.
- DECISIONS row about `useTransition` vs `<form action>` → Task 7 Step 2.

**Placeholder scan:** no `TBD` / `TODO` / "implement later" / "similar to" in any task; every code block is concrete.

**Type consistency:** `LogExpenseInput` field names match the props passed in Task 3 submit (`tripId`, `tripSlug`, `title`, `amount`, `category`, `paidBy`, `dayDate`). `BudgetTabProps` additions match the call site in Task 5. `EXPENSE_CATEGORIES` / `EXPENSE_CATEGORY_DEFAULT` / `ExpenseCategory` are defined in Task 1 and imported in Tasks 2 and 3.
