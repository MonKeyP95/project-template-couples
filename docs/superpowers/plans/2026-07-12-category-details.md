# Elaborate Categories (per-category details) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trip category in the profile wizard be elaborated with describe-only detail tags (Food → burgers, sushi), stored on the category row.

**Architecture:** Add a `details text[]` column to `expense_categories`, expose it on `ExpenseCategoryRow`, add a `setCategoryDetails` server action, and make the wizard's category step expandable so each category reveals removable detail chips + an add input. Details write live (whole-array replace + `router.refresh()`), matching how add/remove category already behaves. No AI wiring in this slice.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript 5, Tailwind v4, Supabase (Postgres + RLS). No new dependencies.

## Global Constraints

- **No test framework exists.** "Verify" means `pnpm lint` + `pnpm build` pass, plus a manual browser check where noted. Do not invent a test command.
- **Migrations are applied manually.** SQL files are pasted into the Supabase SQL editor by the user; committing/restarting the dev server does nothing to the DB. Every migration must be idempotent (safe to paste-and-run repeatedly). Single shared Supabase project (dev == prod).
- **No emojis** in code, comments, or copy. The `×` glyph is the existing delete affordance — keep it.
- **Sparse comments**; clear names over comments.
- **Client components** import types only from `*-types.ts` modules.
- **Commit only when the user asks.** The commit steps below are the intended commit points during execution; the user drives whether they run.
- **Turbopack Windows flake:** if `pnpm dev`/`pnpm build` fails with a `0xc0000142` subprocess panic, delete `.next/` and retry — not a code bug.

---

### Task 1: Data layer — column, type, query, action

Adds the `details` column and threads it through the type, the loader, and a new write action. No UI yet, so the wizard is unaffected; the build stays green.

**Files:**
- Create: `supabase/migrations/20260712000001_expense_category_details.sql`
- Modify: `src/lib/trips/expense-types.ts` (`ExpenseCategoryRow`)
- Modify: `src/lib/trips/expense-queries.ts` (`getTripExpenseCategories`)
- Modify: `src/lib/trips/actions.ts` (new `setCategoryDetails`; `addExpenseCategory` returns `details`)

**Interfaces:**
- Produces: `ExpenseCategoryRow = { id: string; tripId: string; name: string; sortOrder: number; details: string[] }`
- Produces: `setCategoryDetails(categoryId: string, tripSlug: string, details: string[]): Promise<{ error?: string }>`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260712000001_expense_category_details.sql`:

```sql
-- Describe-only detail tags per expense category (e.g. Food -> burgers, sushi).
-- Profile-intent only; never touches money. Idempotent.
alter table public.expense_categories
  add column if not exists details text[] not null default '{}';
```

- [ ] **Step 2: Add `details` to `ExpenseCategoryRow`**

In `src/lib/trips/expense-types.ts`, change the interface (around line 88-94):

```ts
/** A per-trip expense category row (see expense_categories). */
export interface ExpenseCategoryRow {
  id: string
  tripId: string
  name: string
  sortOrder: number
  details: string[]
}
```

- [ ] **Step 3: Select `details` in the loader**

In `src/lib/trips/expense-queries.ts`, update `getTripExpenseCategories`:

```ts
  const { data } = await supabase
    .from("expense_categories")
    .select("id, trip_id, name, sort_order, details")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    sortOrder: row.sort_order,
    details: row.details ?? [],
  }))
```

- [ ] **Step 4: Return `details` from `addExpenseCategory`**

In `src/lib/trips/actions.ts`, in `addExpenseCategory`, change the insert `.select(...)` and the returned object so the new category satisfies `ExpenseCategoryRow` (a new category has no details):

```ts
  const { data, error } = await supabase
    .from("expense_categories")
    .insert({
      trip_id: tripId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, trip_id, name, sort_order, details")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A category with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {
    category: {
      id: data.id,
      tripId: data.trip_id,
      name: data.name,
      sortOrder: data.sort_order,
      details: data.details ?? [],
    },
  }
```

- [ ] **Step 5: Add the `setCategoryDetails` action**

In `src/lib/trips/actions.ts`, add this near `deleteExpenseCategory` (after it is fine):

```ts
/** Replace a category's describe-only detail tags. Trims, drops blanks,
 * de-dupes, caps at 20. RLS gates the write to workspace members. */
export async function setCategoryDetails(
  categoryId: string,
  tripSlug: string,
  details: string[],
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const clean = Array.from(
    new Set(details.map((d) => d.trim()).filter(Boolean)),
  ).slice(0, 20)

  const { error } = await supabase
    .from("expense_categories")
    .update({ details: clean })
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 6: Verify lint and build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds. If it fails complaining that some other place constructs an `ExpenseCategoryRow` without `details`, add `details: []` (or select `details`) there — read the flagged line first. If it fails with a `0xc0000142` panic, delete `.next/` and re-run.

Note: the column does not exist in the DB until the migration is pasted (Task 2 covers that before the smoke test); build/type-check does not need the DB.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260712000001_expense_category_details.sql src/lib/trips/expense-types.ts src/lib/trips/expense-queries.ts src/lib/trips/actions.ts
git commit -m "feat(categories): details column, type, loader, setCategoryDetails action"
```

---

### Task 2: Wizard UI — expandable category rows with detail chips

Rewrites the wizard's `CategoryStep` so each category expands to show removable detail chips + an add input.

**Files:**
- Modify: `src/app/trips/[slug]/profile-wizard.tsx` (`CategoryStep`; add `CategoryRow`; import `setCategoryDetails`)

**Interfaces:**
- Consumes: `ExpenseCategoryRow` with `details` (Task 1); `setCategoryDetails`, `addExpenseCategory`, `deleteExpenseCategory` (existing).

- [ ] **Step 1: Import `setCategoryDetails`**

In `src/app/trips/[slug]/profile-wizard.tsx`, extend the actions import:

```tsx
import {
  addExpenseCategory,
  deleteExpenseCategory,
  saveTripProfile,
  setCategoryDetails,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Replace the `CategoryStep` function**

Replace the entire existing `CategoryStep` function with the version below plus a new `CategoryRow` component. (The step still renders category rows then an add-category input; each row is now expandable.)

```tsx
/** The backbone step: the trip's expense_categories as expandable rows. Each
 * row can be opened to elaborate the category with describe-only detail tags
 * (Food -> burgers, sushi). Add/remove category and details all write live
 * (same actions/behavior as the Budget categories editor). */
function CategoryStep({
  tripId,
  tripSlug,
  categories,
}: {
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function addCategory() {
    const t = name.trim()
    if (!t || pending) return
    startTransition(async () => {
      const r = await addExpenseCategory(tripId, tripSlug, t)
      if (r.error) {
        setError(r.error)
        return
      }
      setName("")
      setError(null)
      router.refresh()
    })
  }

  function removeCategory(c: ExpenseCategoryRow) {
    if (pending) return
    if (
      !confirm(
        `Delete "${c.name}"? Its expenses move to "Other" and its planned budget items are removed.`,
      )
    )
      return
    startTransition(async () => {
      const r = await deleteExpenseCategory(c.id, tripSlug)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  function saveDetails(c: ExpenseCategoryRow, details: string[]) {
    startTransition(async () => {
      const r = await setCategoryDetails(c.id, tripSlug, details)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <>
      {categories.map((c) => (
        <CategoryRow
          key={c.id}
          category={c}
          expanded={expandedId === c.id}
          pending={pending}
          onToggle={() =>
            setExpandedId((id) => (id === c.id ? null : c.id))
          }
          onRemove={() => removeCategory(c)}
          onAddDetail={(item) => saveDetails(c, [...c.details, item])}
          onRemoveDetail={(item) =>
            saveDetails(
              c,
              c.details.filter((d) => d !== item),
            )
          }
        />
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCategory()
            }
          }}
          placeholder="Add a category…"
          disabled={pending}
          className="flex-1 rounded-xl border border-dashed border-rule bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addCategory}
          disabled={pending || !name.trim()}
          className="rounded-xl border-0 bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          add
        </button>
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </>
  )
}

/** One category: a header (name toggles expand, `×` removes the category) and,
 * when expanded, its detail tags as removable chips plus an add input. The
 * add-detail input owns its own text state. */
function CategoryRow({
  category,
  expanded,
  pending,
  onToggle,
  onRemove,
  onAddDetail,
  onRemoveDetail,
}: {
  category: ExpenseCategoryRow
  expanded: boolean
  pending: boolean
  onToggle: () => void
  onRemove: () => void
  onAddDetail: (item: string) => void
  onRemoveDetail: (item: string) => void
}) {
  const [detail, setDetail] = React.useState("")

  function add() {
    const t = detail.trim()
    if (!t || pending) return
    if (!category.details.includes(t)) onAddDetail(t)
    setDetail("")
  }

  return (
    <div className="rounded-xl border border-rule">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left text-[15px] text-foreground"
        >
          {category.name}
          {category.details.length ? (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
              · {category.details.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={pending}
          aria-label={`Delete ${category.name}`}
          className="font-mono text-[15px] text-muted-foreground hover:text-clay disabled:opacity-50"
        >
          ×
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-rule px-4 py-3">
          {category.details.length ? (
            <div className="flex flex-wrap gap-1.5">
              {category.details.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => onRemoveDetail(d)}
                    disabled={pending}
                    aria-label={`Remove ${d}`}
                    className="text-muted-foreground hover:text-clay disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="add specific…"
            disabled={pending}
            className="mt-2 w-full rounded-lg border border-dashed border-rule bg-transparent px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Verify lint and build**

Run: `pnpm lint`
Expected: no errors. (Watch the React 19 gotcha: a bare `//` in JSX text must be an expression — not used here.)

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Apply the migration, then manual browser check**

First paste `supabase/migrations/20260712000001_expense_category_details.sql` into the Supabase SQL editor and run it (idempotent). Then `pnpm dev`, open a trip's **Profile** tab, go to the Categories step. Verify:
- Tapping a category name expands it; tapping again (or another) collapses it (one open at a time).
- Typing "burgers" + Enter in "add specific…" shows a `burgers ×` chip; refresh the page — the chip persists and the collapsed row shows `· 1`.
- The chip `×` removes it and persists; the category `×` still deletes the whole category (with confirm).
- The Budget tab is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/profile-wizard.tsx
git commit -m "feat(trip-profile): elaborate categories with detail chips"
```

- [ ] **Step 6: Update docs**

Mark the slice done in `docs/TODO.md` and append a `docs/DECISIONS.md` row: per-category `details text[]` extends the existing category row (survives rename, cascades on delete); describe-only, AI wiring deferred to the profile-aware-suggestions slice. Commit:

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record category details slice"
```

---

## Notes for the implementer

- **Two-speed persistence, continued:** details write live (like add/remove category), independent of the wizard's final Save. Do not route details through `saveTripProfile`.
- **Migration timing:** the code compiles without the DB column, but the feature only works once the migration is pasted into Supabase (single shared project). Apply it before the Task 2 smoke test.
- **Last-write-wins** on the whole `details` array is intentional and fine for a two-person app — do not add optimistic locking or per-item RPCs.
