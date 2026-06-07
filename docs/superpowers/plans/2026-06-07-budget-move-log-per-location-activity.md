# Budget-Move Log + Per-Location Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every budget move as a dated log entry (shown in the main ledger and per location, excluded from spend/settle-up), add an effective-location chip to every main-ledger expense row, and make each location envelope expand to its own ledger (attributed expenses + budget moves).

**Architecture:** One new table `trip_budget_moves`, logged atomically inside the existing `move_location_budget` RPC. A pure module (`location-budget-types.ts`) gains a `BudgetMove` type plus derivation helpers; a new query loads moves; the trip page threads them into the budget tab. The main ledger merges expenses + moves by date; each `EnvelopeRow` expands to its filtered activity, reusing the editable `LedgerRow`.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript 5, Tailwind v4, Supabase (Postgres + RLS + plpgsql RPC). Package manager: `pnpm`.

**Verification note:** This repo has **no test runner** and CLAUDE.md forbids inventing one. Each task is verified with `pnpm lint` + `pnpm build`, plus manual in-app checks. The pure helpers in Task 2 are the natural future unit-test seam; do not add a runner.

**Conventions (CLAUDE.md / memory):** idempotent migrations; `"use client"` files import query-layer types from `*-types.ts`, never `*-queries.ts`; no emojis; sparse comments; short functions; no defensive code for impossible cases. If `pnpm build` flakes with Turbopack exit `0xc0000142` on Windows, delete `.next` and re-run once. Commit after each task.

**Builds on:** `docs/superpowers/specs/2026-06-07-budget-move-log-per-location-activity-design.md`. The `move_location_budget` RPC and the `expenseLocationId` attribution already exist on this branch.

---

## File Structure

**Create:**
- `supabase/migrations/20260607000001_budget_moves.sql` — `trip_budget_moves` table + RLS + `create or replace move_location_budget` (now logs the move).
- `src/lib/trips/budget-move-queries.ts` — `getTripBudgetMoves(tripId)`.
- `src/app/trips/[slug]/budget-move-row.tsx` — read-only presentational row for a move (main-ledger form + per-location signed form via a prop).

**Modify:**
- `src/lib/trips/location-budget-types.ts` — add `BudgetMove` type + `effectiveLocation`, `expensesForLocation`, `movesForLocation` helpers.
- `src/app/trips/[slug]/ledger-row.tsx` — optional `locationChip` prop on `LedgerRow`/`LedgerRowView`.
- `src/app/trips/[slug]/budget-tab.tsx` — `Ledger` merges expenses+moves and computes chips; thread `moves` + build `dayMap`/`locationsById`; pass `members`+`moves` to `BudgetByLocation`.
- `src/app/trips/[slug]/budget-by-location.tsx` — `members`+`moves` props; expandable `EnvelopeRow` + `UnassignedRow` showing per-location activity.
- `src/app/trips/[slug]/page.tsx` — load moves for the budget tab; pass to `BudgetTab`.
- `docs/TODO.md`, `docs/DECISIONS.md`.

---

## Task 1: Migration — budget-move log table + RPC logs the move

**Files:**
- Create: `supabase/migrations/20260607000001_budget_moves.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Budget-move log: a dated record of each budget reallocation between location
-- envelopes (or the unallocated pool). An allocation event, NOT spend -- never
-- counted toward expenses or settle-up. from/to null = the unallocated pool (a
-- since-deleted location also reads null -> rendered "Unallocated"). RLS mirrors
-- trip_savings_contributions. Idempotent: safe to paste-and-run repeatedly.

create table if not exists public.trip_budget_moves (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  from_location_id uuid references public.itinerary_locations(id) on delete set null,
  to_location_id   uuid references public.itinerary_locations(id) on delete set null,
  amount_cents     integer not null check (amount_cents > 0),
  created_by       uuid not null references auth.users(id) on delete restrict,
  created_at       timestamptz not null default now()
);

create index if not exists trip_budget_moves_trip_idx
  on public.trip_budget_moves (trip_id, created_at desc);

alter table public.trip_budget_moves enable row level security;

drop policy if exists budget_moves_select on public.trip_budget_moves;
create policy budget_moves_select on public.trip_budget_moves
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists budget_moves_insert on public.trip_budget_moves;
create policy budget_moves_insert on public.trip_budget_moves
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and created_by = auth.uid()
  );

drop policy if exists budget_moves_delete on public.trip_budget_moves;
create policy budget_moves_delete on public.trip_budget_moves
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Re-create the move RPC so it also logs the move, atomically with the budget
-- change (same transaction). auth.uid() is the caller under SECURITY INVOKER.
create or replace function public.move_location_budget(
  p_trip_id uuid,
  p_from    uuid,
  p_to      uuid,
  p_amount  integer
) returns void
language plpgsql
as $$
declare
  v_from_budget integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  if p_from is not null then
    select budget_cents into v_from_budget
    from public.itinerary_locations
    where id = p_from and trip_id = p_trip_id
    for update;
    if not found then
      raise exception 'Source location not found.';
    end if;
    if v_from_budget is null then
      raise exception 'Source has no budget to move.';
    end if;
    if v_from_budget < p_amount then
      raise exception 'Not enough budget to move.';
    end if;
  end if;

  if p_to is not null then
    update public.itinerary_locations
    set budget_cents = coalesce(budget_cents, 0) + p_amount
    where id = p_to and trip_id = p_trip_id;
    if not found then
      raise exception 'Destination location not found.';
    end if;
  end if;

  if p_from is not null then
    update public.itinerary_locations
    set budget_cents = nullif(v_from_budget - p_amount, 0)
    where id = p_from;
  end if;

  insert into public.trip_budget_moves
    (trip_id, from_location_id, to_location_id, amount_cents, created_by)
  values
    (p_trip_id, p_from, p_to, p_amount, auth.uid());
end;
$$;
```

- [ ] **Step 2: Apply it**

Paste into the Supabase SQL editor and run (this repo applies migrations manually). Re-run once to confirm idempotency. Expected: succeeds both times; second run is a no-op for the table and a harmless `create or replace` for the function.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000001_budget_moves.sql
git commit -m "feat(budget): budget-move log table; RPC records each move"
```

---

## Task 2: Types + query for budget moves and derivations

Add the pure pieces consumers will need. No UI yet — builds green with no consumers.

**Files:**
- Modify: `src/lib/trips/location-budget-types.ts`
- Create: `src/lib/trips/budget-move-queries.ts`

- [ ] **Step 1: Add the `BudgetMove` type and helpers**

Append to `src/lib/trips/location-budget-types.ts` (after the existing `groupByMonth` function, before end of file):

```ts
export interface BudgetMove {
  id: string
  tripId: string
  fromLocationId: string | null
  toLocationId: string | null
  amountCents: number
  createdBy: string
  createdAt: string
}

/** Non-settlement expenses attributed to `locationId` (null = Unassigned). */
export function expensesForLocation(
  expenses: Expense[],
  dayMap: Record<string, string>,
  locationId: string | null,
): Expense[] {
  return expenses.filter(
    (e) => !e.isSettlement && expenseLocationId(e, dayMap) === locationId,
  )
}

/** Moves touching `locationId`, signed by perspective: +in (destination), -out (source). */
export function movesForLocation(
  moves: BudgetMove[],
  locationId: string,
): { move: BudgetMove; signedCents: number }[] {
  const out: { move: BudgetMove; signedCents: number }[] = []
  for (const m of moves) {
    if (m.toLocationId === locationId) {
      out.push({ move: m, signedCents: m.amountCents })
    } else if (m.fromLocationId === locationId) {
      out.push({ move: m, signedCents: -m.amountCents })
    }
  }
  return out
}

/** The location chip for a main-ledger row: effective attribution + whether tagged. */
export function effectiveLocation(
  expense: Pick<Expense, "locationId" | "dayDate">,
  dayMap: Record<string, string>,
  locationsById: Record<string, string>,
): { name: string | null; tagged: boolean } {
  const id = expenseLocationId(expense, dayMap)
  return {
    name: id ? locationsById[id] ?? null : null,
    tagged: expense.locationId !== null,
  }
}
```

- [ ] **Step 2: Create the moves query**

Create `src/lib/trips/budget-move-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"
import type { BudgetMove } from "./location-budget-types"

export async function getTripBudgetMoves(tripId: string): Promise<BudgetMove[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_budget_moves")
    .select(
      "id, trip_id, from_location_id, to_location_id, amount_cents, created_by, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    amountCents: row.amount_cents,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }))
}
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS (no consumers yet; confirms types/imports resolve).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/location-budget-types.ts src/lib/trips/budget-move-queries.ts
git commit -m "feat(budget): BudgetMove type, per-location derivations, moves query"
```

## Task 3: Effective-location chip on main-ledger rows

Show which location each expense is filed under. Reuses `effectiveLocation`
(Task 2). Independent of the moves table — works at runtime now.

**Files:**
- Modify: `src/app/trips/[slug]/ledger-row.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Add the optional `locationChip` prop to `LedgerRow`**

In `src/app/trips/[slug]/ledger-row.tsx`, add the field to `LedgerRowProps`:

```ts
export interface LedgerRowProps {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  locationChip?: { name: string | null; tagged: boolean }
}
```

Update the `LedgerRow` function to accept and forward it to the view (the editor
does not need it):

```tsx
export function LedgerRow({
  expense,
  members,
  tripSlug,
  locations,
  locationChip,
}: LedgerRowProps) {
  const [editing, setEditing] = React.useState(false)

  if (editing && !expense.isSettlement) {
    return (
      <LedgerRowEditor
        expense={expense}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        onDone={() => setEditing(false)}
      />
    )
  }

  return (
    <LedgerRowView
      expense={expense}
      members={members}
      tripSlug={tripSlug}
      locationChip={locationChip}
      onEdit={() => setEditing(true)}
    />
  )
}
```

- [ ] **Step 2: Render the chip in `LedgerRowView`**

In the same file, update `LedgerRowView`'s signature to accept `locationChip`:

```tsx
function LedgerRowView({
  expense,
  members,
  tripSlug,
  locationChip,
  onEdit,
}: {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locationChip?: { name: string | null; tagged: boolean }
  onEdit: () => void
}) {
```

Then render the chip inside the badge row — change that block from:

```tsx
        <div className="mt-1 flex items-center gap-2">
          <MonoBadge tone={tone}>{expense.category}</MonoBadge>
          <span className="font-mono text-[10px] text-muted-foreground">
            paid by
          </span>
          {payer ? (
            <Avatar name={payer.initial} size={16} tone={payer.tone} />
          ) : null}
        </div>
```

to:

```tsx
        <div className="mt-1 flex items-center gap-2">
          <MonoBadge tone={tone}>{expense.category}</MonoBadge>
          <span className="font-mono text-[10px] text-muted-foreground">
            paid by
          </span>
          {payer ? (
            <Avatar name={payer.initial} size={16} tone={payer.tone} />
          ) : null}
          {locationChip ? (
            <span
              className={`font-mono text-[10px] ${
                locationChip.tagged ? "text-clay" : "text-muted-foreground"
              }`}
              title={locationChip.tagged ? "Tagged location" : "Location by date"}
            >
              {locationChip.name ? `@${locationChip.name}` : "unassigned"}
            </span>
          ) : null}
        </div>
```

(Tagged expenses render the location in clay; date-derived ones in muted — visually distinct, no emoji.)

- [ ] **Step 3: Compute chips in `Ledger` and pass `itineraryDays`**

In `src/app/trips/[slug]/budget-tab.tsx`, widen the `location-budget-types` import (currently `import { type DayLocation } from ...`) to:

```ts
import {
  dayLocationMap,
  effectiveLocation,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
```

Replace the entire `Ledger` function with:

```tsx
function Ledger({
  expenses,
  members,
  tripSlug,
  locations,
  itineraryDays,
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
}) {
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0
  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-1.5">
        <Label>Ledger · {expenses.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          most recent
        </span>
      </div>
      <div>
        {expenses.map((e) => (
          <LedgerRow
            key={e.id}
            expense={e}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
            locationChip={
              hasLocations
                ? effectiveLocation(e, dayMap, locationsById)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}
```

Then pass `itineraryDays` at the `<Ledger>` call site (in `BudgetTab`'s JSX), so it reads:

```tsx
      <Ledger
        expenses={expenses}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        itineraryDays={itineraryDays}
      />
```

- [ ] **Step 4: Verify**

Run: `pnpm build` then `pnpm lint`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/ledger-row.tsx" "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): show effective-location chip on ledger rows"
```

---

## Task 4: Budget-move row + main-ledger interleave + load moves

Render moves in the main ledger, interleaved with expenses by date.

**Files:**
- Create: `src/app/trips/[slug]/budget-move-row.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Create the move row component**

Create `src/app/trips/[slug]/budget-move-row.tsx`:

```tsx
import type { BudgetMove } from "@/lib/trips/location-budget-types"

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function moveDate(iso: string): { mon: string; day: string } {
  const d = new Date(iso)
  return { mon: MONTH_SHORT.format(d).toUpperCase(), day: String(d.getUTCDate()) }
}

/**
 * Read-only record of a budget move. Two forms:
 * - main ledger (no perspective): "Hokkaido -> Tokyo", muted amount.
 * - per-location (perspectiveLocationId set): signed "+€X from <other>" /
 *   "-€X to <other>".
 */
export function BudgetMoveRow({
  move,
  locationsById,
  perspectiveLocationId,
}: {
  move: BudgetMove
  locationsById: Record<string, string>
  perspectiveLocationId?: string
}) {
  const nameOf = (id: string | null) =>
    id ? locationsById[id] ?? "Unallocated" : "Unallocated"
  const date = moveDate(move.createdAt)

  if (perspectiveLocationId) {
    const incoming = move.toLocationId === perspectiveLocationId
    const other = incoming ? nameOf(move.fromLocationId) : nameOf(move.toLocationId)
    return (
      <div className="flex items-baseline justify-between py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon} {date.day} · budget {incoming ? `from ${other}` : `to ${other}`}
        </span>
        <span
          className={`t-num text-[12px] ${incoming ? "text-moss" : "text-clay"}`}
        >
          {incoming ? "+" : "−"}€{fmt(move.amountCents)}
        </span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3">
      <div className="text-center">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon}
        </div>
        <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
          {date.day}
        </div>
      </div>
      <div>
        <div className="text-[14px] tracking-[-0.005em] text-foreground">
          {nameOf(move.fromLocationId)} → {nameOf(move.toLocationId)}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          budget move
        </div>
      </div>
      <div className="t-num text-[15px] text-muted-foreground">
        €{fmt(move.amountCents)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Merge moves into the main `Ledger`**

In `src/app/trips/[slug]/budget-tab.tsx`, add imports (alongside the existing ones):

```ts
import {
  dayLocationMap,
  effectiveLocation,
  type BudgetMove,
  type DayLocation,
} from "@/lib/trips/location-budget-types"

import { BudgetMoveRow } from "./budget-move-row"
```

(Replace the `location-budget-types` import line from Task 3 with the one above — it just adds `BudgetMove`. Add the `BudgetMoveRow` import next to the other `./` imports.)

Add `moves` to `BudgetTabProps`:

```ts
  itineraryDays: DayLocation[]
  moves: BudgetMove[]
  currentUserId: string
```

Destructure `moves` in the `BudgetTab({ ... })` signature (next to `itineraryDays`).

Replace the entire `Ledger` function (the Task 3 version) with the merged version:

```tsx
function Ledger({
  expenses,
  moves,
  members,
  tripSlug,
  locations,
  itineraryDays,
}: {
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
}) {
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0
  const items = [
    ...expenses.map((e) => ({ kind: "expense" as const, at: e.createdAt, expense: e })),
    ...moves.map((m) => ({ kind: "move" as const, at: m.createdAt, move: m })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-1.5">
        <Label>Ledger · {expenses.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          most recent
        </span>
      </div>
      <div>
        {items.map((item) =>
          item.kind === "expense" ? (
            <LedgerRow
              key={`e-${item.expense.id}`}
              expense={item.expense}
              members={members}
              tripSlug={tripSlug}
              locations={locations}
              locationChip={
                hasLocations
                  ? effectiveLocation(item.expense, dayMap, locationsById)
                  : undefined
              }
            />
          ) : (
            <BudgetMoveRow
              key={`m-${item.move.id}`}
              move={item.move}
              locationsById={locationsById}
            />
          ),
        )}
      </div>
    </div>
  )
}
```

Pass `moves` at the `<Ledger>` call site:

```tsx
      <Ledger
        expenses={expenses}
        moves={moves}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        itineraryDays={itineraryDays}
      />
```

- [ ] **Step 3: Load moves on the page**

In `src/app/trips/[slug]/page.tsx`, add the import (next to the other trip queries):

```ts
import { getTripBudgetMoves } from "@/lib/trips/budget-move-queries"
```

Add a `budgetMoves` entry to the `Promise.all` (after the `getTripSavings` line) and to the destructure array. The destructure becomes:

```ts
  const [datedItinerary, dreamItinerary, locations, notes, packingItems, packingCategories, expenses, savings, budgetMoves] =
    await Promise.all([
```

and add this as the last array element, after `getTripSavings(header.id, memberIds),`:

```ts
      activeTab === "budget" ? getTripBudgetMoves(header.id) : Promise.resolve(null),
```

Then pass it to `<BudgetTab>` (after `itineraryDays={datedItinerary ?? []}`):

```tsx
            itineraryDays={datedItinerary ?? []}
            moves={budgetMoves ?? []}
            currentUserId={userData.user.id}
```

- [ ] **Step 4: Verify**

Run: `pnpm build` then `pnpm lint`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/budget-move-row.tsx" "src/app/trips/[slug]/budget-tab.tsx" "src/app/trips/[slug]/page.tsx"
git commit -m "feat(budget): record budget moves in the main ledger"
```

## Task 5: Per-location activity (expandable envelopes)

Each envelope expands to its own ledger: attributed expenses (editable, reusing
`LedgerRow`) + its budget moves (signed). The Unassigned bucket expands to its
expenses.

**Files:**
- Modify: `src/app/trips/[slug]/budget-by-location.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Imports**

In `src/app/trips/[slug]/budget-by-location.tsx`, replace the `location-budget-types`
import block and add three imports, so the import section reads:

```ts
import { Bar, Label } from "@/components/together"
import { moveLocationBudget, setLocationBudget } from "@/lib/trips/actions"
import type { Expense } from "@/lib/trips/expense-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import {
  dayLocationMap,
  expensesForLocation,
  groupByMonth,
  movesForLocation,
  summarizeEnvelopes,
  type BudgetMove,
  type DayLocation,
  type Envelope,
  type EnvelopeSummary,
  type MonthGroup,
} from "@/lib/trips/location-budget-types"

import { BudgetMoveRow } from "./budget-move-row"
import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"
```

- [ ] **Step 2: Props + dayMap/locationsById on `BudgetByLocation`**

Add `members` and `moves` to `BudgetByLocationProps`:

```ts
export interface BudgetByLocationProps {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  locations: ItineraryLocation[]
  expenses: Expense[]
  itineraryDays: DayLocation[]
  members: Record<string, MemberToneEntry>
  moves: BudgetMove[]
}
```

Replace the `BudgetByLocation` function body so it destructures the new props,
builds the shared maps, and passes everything to `LocationView`:

```tsx
export function BudgetByLocation({
  tripId,
  tripSlug,
  masterBudgetCents,
  locations,
  expenses,
  itineraryDays,
  members,
  moves,
}: BudgetByLocationProps) {
  const [view, setView] = React.useState<View>("location")
  const summary = summarizeEnvelopes(
    expenses,
    locations,
    itineraryDays,
    masterBudgetCents,
  )
  const months = groupByMonth(expenses)
  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="flex items-center justify-between">
        <Label>Budget by {view}</Label>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === "location" ? (
        <LocationView
          tripId={tripId}
          tripSlug={tripSlug}
          masterBudgetCents={masterBudgetCents}
          summary={summary}
          locations={locations}
          expenses={expenses}
          moves={moves}
          members={members}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ) : (
        <MonthView months={months} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace `LocationView` (thread props; swap the static Unassigned for `UnassignedRow`)**

```tsx
function LocationView({
  tripId,
  tripSlug,
  masterBudgetCents,
  summary,
  locations,
  expenses,
  moves,
  members,
  dayMap,
  locationsById,
}: {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  summary: EnvelopeSummary
  locations: ItineraryLocation[]
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  if (locations.length === 0) {
    return (
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {summary.unassignedSpentCents > 0
          ? `Unassigned · €${fmt(summary.unassignedSpentCents)}`
          : "Add locations in the itinerary to budget by place"}
      </div>
    )
  }

  const overAllocated = summary.unallocatedCents < 0
  const targets: MoveTarget[] = [
    { id: null, name: "Unallocated" },
    ...summary.envelopes.map((e) => ({ id: e.locationId, name: e.name })),
  ]

  return (
    <div className="mt-2">
      <div className="flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
        <span>
          Allocated €{fmt(summary.allocatedCents)} of €{fmt(masterBudgetCents)}
        </span>
        <span className={overAllocated ? "text-clay" : ""}>
          {overAllocated
            ? `€${fmt(-summary.unallocatedCents)} over`
            : `€${fmt(summary.unallocatedCents)} unallocated`}
        </span>
      </div>

      {summary.envelopes.map((e) => (
        <EnvelopeRow
          key={e.locationId ?? "none"}
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={e}
          targets={targets}
          expenses={expenses}
          moves={moves}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ))}

      {summary.unassignedSpentCents > 0 ? (
        <UnassignedRow
          tripSlug={tripSlug}
          spentCents={summary.unassignedSpentCents}
          expenses={expenses}
          members={members}
          locations={locations}
          dayMap={dayMap}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Replace `EnvelopeRow` (expand toggle + activity)**

```tsx
function EnvelopeRow({
  tripId,
  tripSlug,
  envelope,
  targets,
  expenses,
  moves,
  members,
  locations,
  dayMap,
  locationsById,
}: {
  tripId: string
  tripSlug: string
  envelope: Envelope
  targets: MoveTarget[]
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  const [moving, setMoving] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const locationId = envelope.locationId as string
  const hasTarget = envelope.budgetCents !== null
  const target = envelope.budgetCents ?? 0
  const leftover = target - envelope.spentCents
  const over = leftover < 0
  const pct =
    hasTarget && target > 0
      ? Math.min(100, Math.round((envelope.spentCents / target) * 100))
      : 0

  return (
    <div className="border-t border-border py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[14px] italic text-foreground">
          {envelope.name}
        </span>
        <span className="t-num text-[13px] text-foreground">
          €{fmt(envelope.spentCents)}
          {hasTarget ? (
            <span className="text-muted-foreground"> / €{fmt(target)}</span>
          ) : null}
        </span>
      </button>

      {hasTarget ? (
        <>
          <div className="mt-2">
            <Bar pct={pct} tone={over ? "clay" : "sea"} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{pct}% of budget</span>
            <span className={over ? "text-clay" : ""}>
              {over ? `€${fmt(-leftover)} over` : `€${fmt(leftover)} left`}
            </span>
          </div>
        </>
      ) : null}

      <div className="mt-1.5 flex items-center gap-3">
        <TargetEditor
          tripSlug={tripSlug}
          locationId={locationId}
          budgetCents={envelope.budgetCents}
        />
        {hasTarget && leftover !== 0 ? (
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            {over ? "cover" : "move"}
          </button>
        ) : null}
      </div>

      {moving ? (
        <MoveForm
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={envelope}
          leftover={leftover}
          targets={targets.filter((t) => t.id !== locationId)}
          onDone={() => setMoving(false)}
        />
      ) : null}

      {expanded ? (
        <LocationActivity
          tripSlug={tripSlug}
          locationId={locationId}
          expenses={expenses}
          moves={moves}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={locationsById}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Add `LocationActivity` and `UnassignedRow`**

Append both to `src/app/trips/[slug]/budget-by-location.tsx` (e.g. after `EnvelopeRow`):

```tsx
function LocationActivity({
  tripSlug,
  locationId,
  expenses,
  moves,
  members,
  locations,
  dayMap,
  locationsById,
}: {
  tripSlug: string
  locationId: string | null
  expenses: Expense[]
  moves: BudgetMove[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
  locationsById: Record<string, string>
}) {
  const locExpenses = expensesForLocation(expenses, dayMap, locationId)
  const locMoves = locationId ? movesForLocation(moves, locationId) : []
  const items = [
    ...locExpenses.map((e) => ({ kind: "expense" as const, at: e.createdAt, expense: e })),
    ...locMoves.map(({ move }) => ({ kind: "move" as const, at: move.createdAt, move })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  if (items.length === 0) {
    return (
      <div className="mt-1 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        No activity yet
      </div>
    )
  }

  return (
    <div className="mt-1 border-t border-rule">
      {items.map((item) =>
        item.kind === "expense" ? (
          <LedgerRow
            key={`e-${item.expense.id}`}
            expense={item.expense}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
          />
        ) : (
          <BudgetMoveRow
            key={`m-${item.move.id}`}
            move={item.move}
            locationsById={locationsById}
            perspectiveLocationId={locationId as string}
          />
        ),
      )}
    </div>
  )
}

function UnassignedRow({
  tripSlug,
  spentCents,
  expenses,
  members,
  locations,
  dayMap,
}: {
  tripSlug: string
  spentCents: number
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  dayMap: Record<string, string>
}) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <div className="border-t border-border py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[14px] italic text-muted-foreground">
          Unassigned
        </span>
        <span className="t-num text-[13px] text-foreground">
          €{fmt(spentCents)}
        </span>
      </button>
      {expanded ? (
        <LocationActivity
          tripSlug={tripSlug}
          locationId={null}
          expenses={expenses}
          moves={[]}
          members={members}
          locations={locations}
          dayMap={dayMap}
          locationsById={{}}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 6: Pass `members` + `moves` from `BudgetTab`**

In `src/app/trips/[slug]/budget-tab.tsx`, update the `<BudgetByLocation>` render to add the two props:

```tsx
      <BudgetByLocation
        tripId={tripId}
        tripSlug={tripSlug}
        masterBudgetCents={plannedBudgetCents}
        locations={locations}
        expenses={expenses}
        itineraryDays={itineraryDays}
        members={members}
        moves={moves}
      />
```

(`members` and `moves` are already in `BudgetTab`'s scope — `members` is an
existing prop; `moves` was added to `BudgetTabProps` in Task 4.)

- [ ] **Step 7: Verify**

Run: `pnpm build` then `pnpm lint`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/trips/[slug]/budget-by-location.tsx" "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): expandable per-location activity (expenses + moves)"
```

---

## Task 6: Docs + final verification

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Update `docs/TODO.md`**

Add a completed entry matching the file's existing checklist format:

> Budget-move log + per-location activity: each budget move is logged
> (`trip_budget_moves`, written atomically in the `move_location_budget` RPC),
> shown in the main ledger and per location, excluded from spent/settle-up; each
> envelope expands to its attributed expenses (editable) + moves; main-ledger
> rows show an effective-location chip. Migration
> `20260607000001_budget_moves.sql`.

- [ ] **Step 2: Append a row to `docs/DECISIONS.md`**

Match the table format (escape any `|` in text as `\|`). Record:

> **Budget moves are logged in their own `trip_budget_moves` table, written
> atomically inside the `move_location_budget` RPC; never counted as spend.** A
> move is an allocation event, not spending, so it must stay out of
> `summarizeBudget` (spent total + settle-up) — a separate table guarantees that
> by construction. Logging inside the RPC keeps the record consistent with the
> budget change. Per-location activity (expenses + moves under each envelope) and
> the main-ledger location chip are pure derivations of existing attribution — no
> expense-model change. Deleted-location endpoints render "Unallocated" (FK set
> null) rather than carrying denormalized name snapshots. Date: 2026-06-07.

- [ ] **Step 3: Final build + lint**

Run: `pnpm build` then `pnpm lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget-move log + per-location activity"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Budget-move log table + RLS → Task 1. Atomic log in RPC → Task 1.
- `BudgetMove` type, `getTripBudgetMoves`, pure helpers → Task 2.
- Effective-location chip on main-ledger rows (tagged distinct) → Task 3.
- Main-ledger interleave of moves (read-only, excluded from spent/settle-up) → Task 4 (+ page load).
- Per-location activity: expandable envelopes, editable expenses, signed moves, expandable Unassigned → Task 5.
- Moves never enter `summarizeBudget` (separate table; `Ledger` count stays `expenses.length`) → by construction.
- Docs/decisions → Task 6.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `BudgetMove` (camel fields `fromLocationId`/`toLocationId`/`amountCents`/`createdAt`), `expensesForLocation`, `movesForLocation`, `effectiveLocation`, `getTripBudgetMoves`, `BudgetMoveRow` (`move`/`locationsById`/`perspectiveLocationId`), `LedgerRow` `locationChip?`, `Ledger` `moves`+`itineraryDays`, `BudgetByLocation` `members`+`moves` are used identically across the tasks that define and consume them. The RPC keeps its existing 4-arg signature, so `moveLocationBudget` (the action) is unchanged.

**Runtime note:** Task 1's migration must be applied in Supabase before moves persist/appear; the move action already calls the (now logging) RPC, so no action change is needed.


