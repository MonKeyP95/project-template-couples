# Savings Contribution Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Saved so far" from a single anonymous `trips.saved_cents` pot into a per-person contribution log, surfaced via tap-to-expand, with the saved total derived from the log.

**Architecture:** New `trip_savings_contributions` table is the single source of truth; `trips.saved_cents` is dropped and the total becomes `SUM(amount_cents)`. Two server actions (add credited to current user, delete) mirror the existing expense actions. The "Saved so far" headline and moss bar stay as-is; tapping the saved number expands an inline panel with per-person cards and a deletable log.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase Postgres + RLS, TypeScript, Tailwind v4.

**Note on validation:** This repo has no test suite, and CLAUDE.md forbids inventing a test command. Each task is validated with `pnpm lint` + `pnpm build` and, where relevant, manual checks in `pnpm dev`. Do not create test files.

**Spec:** `docs/superpowers/specs/2026-06-06-savings-contribution-log-design.md`

---

## File Structure

- Create: `supabase/migrations/20260606000001_savings_contributions.sql` — table, RLS, drop `saved_cents`.
- Create: `src/lib/trips/savings-types.ts` — `SavingsContribution` type + pure `summarizeSavings`.
- Create: `src/lib/trips/savings-queries.ts` — `getTripSavings` (server).
- Modify: `src/lib/trips/actions.ts` — add `addSavingsContribution`, `deleteSavingsContribution`; trim `updateTripBudget`.
- Modify: `src/lib/trips/queries.ts` — drop `savedCents` from `TripHeader`.
- Modify: `src/lib/trips/list-queries.ts` — derive per-trip saved total.
- Modify: `src/app/trips/[slug]/page.tsx` — fetch savings, derive total, thread props.
- Modify: `src/app/trips/[slug]/budget-tab.tsx` — thread savings props.
- Modify: `src/app/trips/[slug]/budget-figures.tsx` — expand panel, per-person cards, log.

`src/app/home/trip-cards.tsx` needs **no change** — it reads `TripListItem.savedCents`, whose field name is unchanged (only its value source changes).

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260606000001_savings_contributions.sql`

- [ ] **Step 1: Write the migration**

Mirrors the `expenses` RLS pattern (`public.is_trip_workspace_member`). Idempotent per the repo rule (safe to paste-and-run repeatedly).

```sql
-- Savings contribution log: per-person, dated rows. Replaces the single
-- trips.saved_cents pot — the saved total is now SUM(amount_cents) per trip.
-- RLS mirrors expenses (access gated by trip -> workspace membership).
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_savings_contributions (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at   timestamptz not null default now()
);

create index if not exists trip_savings_contributions_trip_idx
  on public.trip_savings_contributions (trip_id, created_at desc);

alter table public.trip_savings_contributions enable row level security;

drop policy if exists savings_select on public.trip_savings_contributions;
create policy savings_select on public.trip_savings_contributions
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

-- Inserter must be a workspace member of the trip, and user_id must be the
-- caller (contributions are always self-credited).
drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and user_id = auth.uid()
  );

drop policy if exists savings_delete on public.trip_savings_contributions;
create policy savings_delete on public.trip_savings_contributions
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Drop the old single-pot column; the log is now the source of truth.
alter table public.trips drop column if exists saved_cents;
```

- [ ] **Step 2: Apply the migration**

Run it against the Supabase project (paste into the SQL editor, or via your usual apply step). Expected: no errors; running it twice is also clean.

- [ ] **Step 3: Verify**

Confirm `trip_savings_contributions` exists with RLS enabled and that `trips` no longer has a `saved_cents` column. Expected: table present, column gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000001_savings_contributions.sql
git commit -m "feat(budget): savings contributions table; drop trips.saved_cents"
```

---

## Task 2: Savings types + summary helper

**Files:**
- Create: `src/lib/trips/savings-types.ts`

This is the client-importable module (no `next/headers`), per the client/`*-types` split rule. `summarizeSavings` is pure.

- [ ] **Step 1: Write the module**

```ts
export interface SavingsContribution {
  id: string
  tripId: string
  userId: string
  amountCents: number
  createdAt: string
}

export interface SavingsSummary {
  /** Sum of all contribution amounts, in cents. */
  totalCents: number
  /** Per-user sum of contribution amounts, in cents. */
  perUser: Record<string, number>
}

/**
 * Pure: total saved plus a per-member breakdown. `memberIds` seeds the
 * breakdown so every member appears (even at 0); contributions from users
 * not in the list still count toward the total.
 */
export function summarizeSavings(
  contributions: SavingsContribution[],
  memberIds: string[],
): SavingsSummary {
  const perUser: Record<string, number> = Object.fromEntries(
    memberIds.map((id) => [id, 0]),
  )
  let totalCents = 0
  for (const c of contributions) {
    totalCents += c.amountCents
    perUser[c.userId] = (perUser[c.userId] ?? 0) + c.amountCents
  }
  return { totalCents, perUser }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/savings-types.ts
git commit -m "feat(budget): savings types + summarizeSavings helper"
```

---

## Task 3: getTripSavings query

**Files:**
- Create: `src/lib/trips/savings-queries.ts`

Mirrors `getTripExpenses` (`expense-queries.ts`).

- [ ] **Step 1: Write the module**

```ts
import { createClient } from "@/lib/supabase/server"
import {
  summarizeSavings,
  type SavingsContribution,
  type SavingsSummary,
} from "./savings-types"

export interface TripSavings extends SavingsSummary {
  contributions: SavingsContribution[]
}

/**
 * All savings contributions for a trip (newest first) plus the derived total
 * and per-member breakdown.
 */
export async function getTripSavings(
  tripId: string,
  memberIds: string[],
): Promise<TripSavings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_savings_contributions")
    .select("id, trip_id, user_id, amount_cents, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  const contributions: SavingsContribution[] = (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  }))

  return { contributions, ...summarizeSavings(contributions, memberIds) }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/savings-queries.ts
git commit -m "feat(budget): getTripSavings query"
```

---

## Task 4: Server actions

**Files:**
- Modify: `src/lib/trips/actions.ts`

Two new actions plus trimming `savedCents` out of `updateTripBudget`. Reuse the module-level `MAX_AMOUNT_CENTS` (line 179) and the `validCents` helper (line 1550).

- [ ] **Step 1: Trim `updateTripBudget`**

In `UpdateTripBudgetInput` (around line 1539), remove the `savedCents` field:

```ts
export interface UpdateTripBudgetInput {
  tripId: string
  tripSlug: string
  plannedBudgetCents?: number
}
```

In the body of `updateTripBudget`, remove the saved-cents branch and narrow the patch type so it now reads:

```ts
  const patch: { planned_budget_cents?: number } = {}

  if (input.plannedBudgetCents !== undefined) {
    if (!validCents(input.plannedBudgetCents)) {
      return { error: "Budget out of range." }
    }
    patch.planned_budget_cents = input.plannedBudgetCents
  }

  if (Object.keys(patch).length === 0) return { error: "Nothing to update." }
```

Also update the docstring above the function so it only mentions the planned budget.

- [ ] **Step 2: Add the savings actions**

Append to `src/lib/trips/actions.ts` (the file already imports `createClient` and `revalidatePath`):

```ts
export interface AddSavingsContributionInput {
  tripId: string
  tripSlug: string
  amountCents: number
}

export interface SavingsActionResult {
  error?: string
}

/**
 * Logs one savings contribution credited to the current user. Each tap of
 * "+ add" inserts a row; the saved total is the sum of these rows.
 */
export async function addSavingsContribution(
  input: AddSavingsContributionInput,
): Promise<SavingsActionResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { error: "Enter an amount greater than zero." }
  }
  if (input.amountCents >= MAX_AMOUNT_CENTS) {
    return { error: "Amount out of range." }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("trip_savings_contributions").insert({
    trip_id: input.tripId,
    user_id: userData.user.id,
    amount_cents: input.amountCents,
  })

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/** Removes one savings contribution. */
export async function deleteSavingsContribution(
  contributionId: string,
  tripSlug: string,
): Promise<SavingsActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_savings_contributions")
    .delete()
    .eq("id", contributionId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors. (Type errors about `savedCents` callers are addressed in later tasks; lint alone should pass. If `pnpm build` is run now it will flag those callers — that is expected until Tasks 5-9 land.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): add/delete savings contribution actions; trim updateTripBudget"
```

---

## Task 5: Drop savedCents from TripHeader

**Files:**
- Modify: `src/lib/trips/queries.ts`

- [ ] **Step 1: Remove the field from the interface and row type**

In `TripHeader` (lines 14-17) delete:

```ts
  /** Shared running total saved toward the budget, in cents. */
  savedCents: number
```

In `interface TripRow` (line 36) delete the `saved_cents: number` line.

- [ ] **Step 2: Stop selecting and returning it**

In the `.select(...)` string (line 52), remove `, saved_cents` so it ends `... planned_budget_cents`.

In the returned object (line 87), delete the `savedCents: trip.saved_cents,` line.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/queries.ts
git commit -m "refactor(budget): drop savedCents from TripHeader (now derived)"
```

---

## Task 6: Derive per-trip saved total in the trip list

**Files:**
- Modify: `src/lib/trips/list-queries.ts`

`TripListItem.savedCents` stays (so `trip-cards.tsx` is untouched); only its value source changes from a column to a sum.

- [ ] **Step 1: Stop reading the dropped column**

In `interface TripRow` (line 42) delete `saved_cents: number`.

In the `.select(...)` string (line 77), remove `, saved_cents` so it ends `... planned_budget_cents, created_at`.

- [ ] **Step 2: Fetch and sum contributions for the listed trips**

Replace the body from the `const rows = data ?? []` line through the `const items: TripListItem[] = rows.map(...)` block with:

```ts
  const rows = data ?? []
  const today = new Date().toISOString().slice(0, 10)

  const tripIds = rows.map((r) => r.id)
  const savedByTrip: Record<string, number> = {}
  if (tripIds.length > 0) {
    const { data: contribRows } = await supabase
      .from("trip_savings_contributions")
      .select("trip_id, amount_cents")
      .in("trip_id", tripIds)
    for (const c of contribRows ?? []) {
      savedByTrip[c.trip_id] = (savedByTrip[c.trip_id] ?? 0) + c.amount_cents
    }
  }

  const items: TripListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    country: row.country,
    startDate: row.start_date,
    endDate: row.end_date,
    fuzzyWhen: row.fuzzy_when,
    lat: asNumber(row.lat),
    lng: asNumber(row.lng),
    plannedBudgetCents: row.planned_budget_cents,
    savedCents: savedByTrip[row.id] ?? 0,
    state: deriveState(today, row.start_date, row.end_date),
  }))
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/list-queries.ts
git commit -m "feat(budget): derive trip-card saved total from contributions"
```

---

## Task 7: Wire savings into the trip page

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Import the savings query**

Add near the other `@/lib/trips` imports (alongside line 19's `getTripExpenses`):

```ts
import { getTripSavings } from "@/lib/trips/savings-queries"
```

- [ ] **Step 2: Fetch savings alongside expenses**

In the `Promise.all` (lines 143-152), add a `savings` entry. Update the destructuring and the array:

```ts
  const [datedItinerary, dreamItinerary, locations, notes, packingItems, packingCategories, expenses, savings] =
    await Promise.all([
      showItinerary && !isDream ? getItineraryDays(header.id) : Promise.resolve(null),
      showItinerary && isDream ? getDreamItineraryDays(header.id) : Promise.resolve(null),
      showItinerary && !isDream ? getItineraryLocations(header.id) : Promise.resolve(null),
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
      getTripSavings(header.id, memberIds),
    ])
```

- [ ] **Step 3: Pass savings to BudgetTab**

Replace the `savedCents={header.savedCents}` line (line 215) in the `<BudgetTab .../>` with:

```tsx
            savedCents={savings.totalCents}
            savingsContributions={savings.contributions}
            savedPerUser={savings.perUser}
```

- [ ] **Step 4: Feed the right-rail saved ring from the derived total**

In the `<DesktopRightRail .../>` `saved={{ ... }}` prop (lines 235-238), change `savedCents: header.savedCents,` to:

```tsx
        saved={{
          savedCents: savings.totalCents,
          plannedCents: header.plannedBudgetCents,
        }}
```

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no new errors. (`pnpm build` still fails until Task 8 updates `BudgetTabProps` — expected.)

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(budget): fetch savings and feed derived total into the trip page"
```

---

## Task 8: Thread savings props through BudgetTab

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Import the contribution type**

Add to the imports at the top:

```ts
import { type SavingsContribution } from "@/lib/trips/savings-types"
```

- [ ] **Step 2: Extend props**

In `BudgetTabProps` (lines 14-24), replace `savedCents: number` with:

```ts
  savedCents: number
  savingsContributions: SavingsContribution[]
  savedPerUser: Record<string, number>
```

- [ ] **Step 3: Accept and forward the new props**

In the `BudgetTab({ ... })` destructure (lines 26-36), add `savingsContributions` and `savedPerUser` after `savedCents`.

Update the `<BudgetHeader .../>` call (lines 44-51) to pass them through:

```tsx
      <BudgetHeader
        tripId={tripId}
        tripSlug={tripSlug}
        tripName={tripName}
        spentCents={totalCents}
        plannedBudgetCents={plannedBudgetCents}
        savedCents={savedCents}
        savingsContributions={savingsContributions}
        savedPerUser={savedPerUser}
        members={members}
      />
```

- [ ] **Step 4: Extend BudgetHeader and forward to BudgetFigures**

In the `BudgetHeader` function (lines 72-102), extend its prop list/types with `savingsContributions: SavingsContribution[]`, `savedPerUser: Record<string, number>`, and `members: Record<string, MemberToneEntry>` (the `MemberToneEntry` type is already imported via `./packing-tab` — add the import if missing: `import type { MemberToneEntry } from "./packing-tab"`; it is already imported at line 7).

Update the `<BudgetFigures .../>` call (lines 92-98) to:

```tsx
        <BudgetFigures
          tripId={tripId}
          tripSlug={tripSlug}
          spentCents={spentCents}
          plannedBudgetCents={plannedBudgetCents}
          savedCents={savedCents}
          contributions={savingsContributions}
          perUser={savedPerUser}
          members={members}
        />
```

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no new errors. (`pnpm build` still fails until Task 9 updates `BudgetFiguresProps` — expected.)

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): thread savings contributions through BudgetTab"
```

---

## Task 9: Expandable per-person savings + log in BudgetFigures

**Files:**
- Modify: `src/app/trips/[slug]/budget-figures.tsx`

This is the visible feature. Three changes: (a) the additive `AmountField` logs a delta via `addSavingsContribution` instead of writing a cumulative total; (b) the big saved number toggles a details panel; (c) the panel renders per-person cards and a deletable log.

- [ ] **Step 1: Update imports**

Replace the action import (line 6) with the new actions, and add the type/Avatar imports:

```ts
import {
  addSavingsContribution,
  deleteSavingsContribution,
  updateTripBudget,
} from "@/lib/trips/actions"
import { Avatar, Bar, Label } from "@/components/together"
import { type SavingsContribution } from "@/lib/trips/savings-types"
import type { MemberToneEntry } from "./packing-tab"
```

(Remove the old standalone `import { Bar, Label } from "@/components/together"` line — it is merged above.)

- [ ] **Step 2: Make `AmountField` additive submit pass the entered amount, not a cumulative total**

In `AmountField.submit` (lines 50-68), the additive branch currently adds to the current value. Change so both modes pass the entered `cents` to `onSave` (additive now means "this is a delta to log"; replace means "this is the new value"). Replace the lines:

```ts
    const cents = Math.round(num * 100)
    const next = additive ? valueCents + cents : cents
    startTransition(async () => {
      const result = await onSave(next)
```

with:

```ts
    const cents = Math.round(num * 100)
    startTransition(async () => {
      const result = await onSave(cents)
```

The `additive` prop still drives the UI (blank-on-open, `+€`, `add` label, `+` cue) — only the numeric contract changed.

- [ ] **Step 3: Extend `BudgetFiguresProps`**

Replace the interface (lines 121-127) with:

```ts
export interface BudgetFiguresProps {
  tripId: string
  tripSlug: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
  contributions: SavingsContribution[]
  perUser: Record<string, number>
  members: Record<string, MemberToneEntry>
}
```

- [ ] **Step 4: Update the component signature and the saved-action binding**

In `BudgetFigures({ ... })` (lines 129-135), destructure the new props (`contributions`, `perUser`, `members`) and add expand state:

```tsx
export function BudgetFigures({
  tripId,
  tripSlug,
  spentCents,
  plannedBudgetCents,
  savedCents,
  contributions,
  perUser,
  members,
}: BudgetFiguresProps) {
  const [expanded, setExpanded] = React.useState(false)
```

Replace the `saveSaved` binding (lines 148-149) so the additive field logs a contribution delta:

```tsx
  const saveSaved = (cents: number) =>
    addSavingsContribution({ tripId, tripSlug, amountCents: cents })
```

(`savePlanned` is unchanged.)

- [ ] **Step 5: Make the big saved number a toggle, and render the panel**

In the "Saved so far" block (lines 187-226), wrap the `€{fmt(savedCents)}` number in a button that toggles `expanded`, and append the details panel after the existing bar block. Replace the inner saved block with:

```tsx
      <div className="mt-5">
        <Label>Saved so far</Label>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="t-display text-[18px] text-muted-foreground">€</span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="t-display t-num border-0 bg-transparent p-0 text-[28px] leading-none text-foreground"
          >
            {fmt(savedCents)}
          </button>
          <AmountField
            additive
            valueCents={savedCents}
            onSave={saveSaved}
            trigger={
              savedCents > 0 ? (
                hasPlanned ? (
                  <span className="t-display text-[18px] text-muted-foreground">
                    {" "}/ €{fmt(plannedBudgetCents)}
                  </span>
                ) : (
                  <span className="t-display text-[18px] text-muted-foreground" />
                )
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  + set savings
                </span>
              )
            }
          />
        </div>
        {hasPlanned && savedCents > 0 ? (
          <>
            <div className="mt-3">
              <Bar pct={savedPct} tone="moss" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              <span>{savedPct}% saved</span>
              <span>€{fmt(savedToGo)} to go</span>
            </div>
          </>
        ) : null}
        {expanded ? (
          <SavingsDetails
            contributions={contributions}
            perUser={perUser}
            members={members}
            tripSlug={tripSlug}
          />
        ) : null}
      </div>
```

- [ ] **Step 6: Add the `SavingsDetails`, per-person cards, and log row components**

Append to the bottom of `src/app/trips/[slug]/budget-figures.tsx`:

```tsx
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function contributionDate(iso: string): { mon: string; day: string } {
  const d = new Date(iso)
  return {
    mon: MONTH_SHORT.format(d).toUpperCase(),
    day: String(d.getUTCDate()),
  }
}

function SavingsDetails({
  contributions,
  perUser,
  members,
  tripSlug,
}: {
  contributions: SavingsContribution[]
  perUser: Record<string, number>
  members: Record<string, MemberToneEntry>
  tripSlug: string
}) {
  const memberEntries = Object.entries(members)
  return (
    <div className="mt-4 border-t border-border pt-4">
      {memberEntries.length === 2 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {memberEntries.map(([userId, member]) => (
            <div
              key={userId}
              className="rounded-lg border border-border bg-card px-3.5 py-3"
            >
              <div className="flex items-center gap-2">
                <Avatar name={member.initial} size={18} tone={member.tone} />
                <span className="font-serif text-[14px] italic text-foreground">
                  {member.displayName}
                </span>
              </div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                saved
              </div>
              <div className="t-num mt-0.5 text-[22px] text-foreground">
                €{fmt(perUser[userId] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {contributions.length === 0 ? (
          <div className="py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            No contributions yet
          </div>
        ) : (
          contributions.map((c) => (
            <SavingsLogRow
              key={c.id}
              contribution={c}
              member={members[c.userId]}
              tripSlug={tripSlug}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SavingsLogRow({
  contribution,
  member,
  tripSlug,
}: {
  contribution: SavingsContribution
  member: MemberToneEntry | undefined
  tripSlug: string
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const date = contributionDate(contribution.createdAt)

  function remove() {
    if (isPending) return
    if (!confirm("Delete this contribution?")) return
    startTransition(async () => {
      const result = await deleteSavingsContribution(contribution.id, tripSlug)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div
      className={`grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border py-3 ${
        isPending ? "opacity-50" : ""
      }`}
    >
      <div className="text-center">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon}
        </div>
        <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
          {date.day}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member ? (
          <Avatar name={member.initial} size={16} tone={member.tone} />
        ) : null}
        <span className="text-[13px] text-foreground">
          {member?.displayName ?? "Someone"}
        </span>
        {error ? (
          <span className="font-mono text-[10px] text-clay">{error}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="t-num text-[15px] text-foreground">
          €{fmt(contribution.amountCents)}
        </span>
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          aria-label="Delete contribution"
          className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Lint and build**

Run: `pnpm lint`
Expected: no new errors.

Run: `pnpm build`
Expected: build succeeds (all `savedCents` callers now consistent).

- [ ] **Step 8: Commit**

```bash
git add src/app/trips/[slug]/budget-figures.tsx
git commit -m "feat(budget): expandable per-person savings + contribution log"
```

---

## Task 10: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev` and open a trip's Budget tab.

- [ ] **Step 2: Verify the headline is unchanged when collapsed**

Expected: "Saved so far" shows the total and the moss bar exactly as before. (If the dev server panics with `0xc0000142` on Windows, stop, delete `.next/`, restart — known Turbopack flake, not a code bug.)

- [ ] **Step 3: Add a contribution**

Tap `+`, enter an amount, submit. Expected: the saved total increases by that amount; the bar advances. Add a second contribution.

- [ ] **Step 4: Expand details**

Tap the big saved number. Expected: a panel appears with per-person cards (2-member trip) whose amounts sum to the total, and a log listing each contribution (date, contributor, amount) newest first, each credited to you.

- [ ] **Step 5: Delete a contribution**

Tap `×` on a log row and confirm. Expected: the row disappears, the total and per-person cards drop accordingly.

- [ ] **Step 6: Verify the home cards**

Go to `/home`. Expected: the trip's "% saved" bar reflects the new derived total.

- [ ] **Step 7: Update docs**

Update `docs/TODO.md` (mark the savings-log task done) and append a row to `docs/DECISIONS.md` noting savings is now a derived contribution log (table is source of truth; `trips.saved_cents` dropped).

- [ ] **Step 8: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record savings contribution log"
```

---

## Self-Review Notes

- **Spec coverage:** table + RLS (T1), drop `saved_cents` (T1/T5/T6), derived total everywhere it was read — detail page (T7), home/list (T6), TripHeader (T5); add/delete actions credited to current user (T4); `updateTripBudget` trimmed (T4); types + helper with client-split (T2); query (T3); headline unchanged + tap-to-expand + per-person cards + deletable log (T9); start-fresh/no-seed (T1, no seed step); out-of-scope items (edit-in-place, realtime, partner-credit) excluded.
- **Type consistency:** `SavingsContribution` fields (`id, tripId, userId, amountCents, createdAt`) are used identically in T2/T3/T8/T9; `summarizeSavings` / `getTripSavings(tripId, memberIds)` / `addSavingsContribution({tripId,tripSlug,amountCents})` / `deleteSavingsContribution(id, tripSlug)` signatures match across tasks; `perUser` and `contributions` prop names consistent T7→T8→T9.
- **No placeholders:** every code step shows full code.
