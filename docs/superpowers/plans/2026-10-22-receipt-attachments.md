# Receipt Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach receipt photos/PDFs to expenses or a per-trip pile, read each one with Claude Haiku on upload, and match pile receipts to expenses.

**Architecture:** New `receipts` table + private `receipts` Storage bucket, both gated by `is_trip_workspace_member`. The browser uploads files straight to Storage, then calls a server action that inserts the row and runs a seventh agent (`read-receipt`) through `runAgent`. A pure `suggestExpenseMatches` ranks expenses for a pile receipt. One shared pile component mounts in the budget tab and on the on-the-road page.

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase Postgres + Storage + RLS (`@supabase/ssr` 0.10 / `supabase-js` 2.106), `@anthropic-ai/sdk` 0.106, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-22-receipt-attachments-design.md`

## Global Constraints

- Reader model: `claude-haiku-5-5`. It is the only new model call and goes through `runAgent`.
- File bytes never pass through a server action (1 MB default body cap).
- Storage path: `{trip_id}/{receipt_id}.{ext}`; bucket `receipts`, private.
- Photos shrunk in the browser to longest edge 1600 px, JPEG. PDFs as-is, cap 10 MB.
- Accepted mime types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- `read_status`: `pending` | `done` | `failed`; `pending` older than 2 minutes is shown as failed.
- Suggestions: at most 3; only non-settlement expenses with no receipt yet.
- Read text never changes an expense's fields.
- Migration must be re-runnable (`if not exists`, drop-then-create policies, `on conflict do nothing`). It is pasted into the Supabase SQL editor by the user; Claude cannot run it.
- No test runner exists in the repo. Do not add one. Pure functions are checked with a throwaway script in the session scratchpad, run with `node` (Node 24 strips TS types), never committed.
- Per-task check is `pnpm lint` + `pnpm exec tsc --noEmit`. `pnpm build` only in the final task, and only after confirming the dev server is stopped (it shares `.next`).
- Client components import from `*-types.ts`, never `*-queries.ts`.
- Dates displayed `en-GB`, day before month. No emojis. Sparse comments.
- Git: commit only the files the task touched (`git add <paths>`); the tree holds unrelated uncommitted migration edits that must not be committed.

## Review Focus

1. **Unsupported file** (HEIC from desktop/Android, a `.docx`, a 15 MB PDF): rejected in the browser before upload with a one-line error; nothing written. Owned by Task 5 (`checkReceiptFile`).
2. **Upload fails on roaming data** mid-way: no row is created and an error shows; in quick-expense the expense is still logged and the error says the receipt wasn't saved. Owned by Tasks 5 and 7.
3. **Receipt total in a different currency from the expense** (e.g. receipt in EUR, expense logged in GBP): not ranked as an amount match, still eligible by date. Owned by Task 2 test.
4. **Expense deleted that had receipts**: receipts reappear in the pile (FK `on delete set null`), files intact. Owned by Task 1 (schema) and Task 6 (pile re-renders after revalidate).
5. **Rotated phone photo** (EXIF orientation): shrinking must keep it upright — use `createImageBitmap(file, { imageOrientation: "from-image" })`. Owned by Task 5.

---

### Task 1: Migration — receipts table, bucket, policies

**Files:**
- Create: `supabase/migrations/20261022000001_receipts.sql`

**Interfaces:**
- Produces: table `public.receipts(id uuid pk, trip_id uuid, expense_id uuid null, storage_path text, mime_type text, uploaded_by uuid default auth.uid(), read_status text default 'pending', reading jsonb null, created_at timestamptz)`; bucket `receipts`.

- [ ] **Step 1: Write the migration**

Contents, all re-runnable:
- `create table if not exists public.receipts` with the columns above. `trip_id` → `trips(id) on delete cascade`; `expense_id` → `expenses(id) on delete set null`; `uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict` (*builder call:* the uploader is always a signed-in user, unlike `paid_by`, which now points at `workspace_people`); `mime_type` check `in ('image/jpeg','image/png','image/webp','application/pdf')`; `read_status` check `in ('pending','done','failed')`.
- Index `receipts_trip_idx on (trip_id, created_at desc)` and `receipts_expense_idx on (expense_id)`, `if not exists`.
- RLS enabled; policies `receipts_select/insert/update/delete` with `is_trip_workspace_member(trip_id)` (drop-then-create). Insert and update `with check` also require `expense_id is null or exists (select 1 from public.expenses e where e.id = expense_id and e.trip_id = receipts.trip_id)`.
- `insert into storage.buckets (id, name, public) values ('receipts','receipts', false) on conflict (id) do nothing;`
- Policies on `storage.objects` named `receipts_objects_select/insert/delete` (drop-then-create), each:
  `bucket_id = 'receipts' and public.is_trip_workspace_member(((storage.foldername(name))[1])::uuid)`.

- [ ] **Step 2: Check it by reading**

Confirm every `create` is guarded, every policy is dropped first, and nothing references a table created later in the file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261022000001_receipts.sql
git commit -m "feat(receipts): table, bucket and RLS"
```

- [ ] **Step 4: Hand to user**

Ask the user to paste the file into the Supabase SQL editor **twice** and report any error. Later tasks don't depend on it for lint/types, so continue while waiting.

---

### Task 2: Types and pure functions

**Files:**
- Create: `src/lib/trips/receipt-types.ts`
- Scratch (not committed): `<scratchpad>/receipt-types.check.ts`

**Interfaces:**
- Consumes: `Expense` from `src/lib/trips/expense-types.ts` (type-only import).
- Produces:
  ```ts
  export type ReceiptMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
  export interface ReceiptReading {
    merchant: string | null
    date: string | null          // yyyy-mm-dd
    totalCents: number | null
    currency: string | null      // ISO 4217
    items: { label: string; amountCents: number | null }[]
    summary: string | null
  }
  export interface Receipt {
    id: string; tripId: string; expenseId: string | null
    storagePath: string; mimeType: ReceiptMime
    readStatus: "pending" | "done" | "failed"
    reading: ReceiptReading | null
    createdAt: string
    url: string                  // signed URL, filled by the query
  }
  export type ReceiptState = "reading" | "failed" | "done"
  export const RECEIPT_MIMES: readonly ReceiptMime[]
  export const RECEIPT_PDF_MAX_BYTES = 10 * 1024 * 1024
  export const READ_STALE_MS = 2 * 60 * 1000
  export function receiptState(r: Pick<Receipt, "readStatus" | "createdAt">, nowMs: number): ReceiptState
  export function suggestExpenseMatches(reading: ReceiptReading | null, expenses: Expense[], receiptExpenseIds: Set<string>): Expense[]
  ```

- [ ] **Step 1: Write the check script** in the scratchpad, importing `../…/src/lib/trips/receipt-types.ts` by absolute path, using `node:assert`:
  - `receiptState({readStatus:"pending", createdAt: t0}, t0 + 60_000) === "reading"`
  - `receiptState({readStatus:"pending", createdAt: t0}, t0 + 121_000) === "failed"`
  - `receiptState({readStatus:"done", ...}, any) === "done"`
  - Given expenses A (EUR 2340, 2026-10-14), B (EUR 2340, 2026-10-16), C (EUR 1999, 2026-10-14), D (GBP 2340, 2026-10-14), S (settlement, EUR 2340, 2026-10-14), R (EUR 2340, 2026-10-14, already has a receipt), and reading `{totalCents:2340, currency:"EUR", date:"2026-10-14"}`: result ids are `["A","B", …]` with A first, never S or R, length ≤ 3.
  - D (other currency, same day) ranks after every same-currency exact-amount match.
  - Reading with `totalCents:null, date:null` → `[]`. `reading === null` → `[]`.
  - Expense with `dayDate:null` and exact amount is still returned (ranked by amount only, after same-amount dated ones within 2 days).

- [ ] **Step 2: Run it, expect failure** — `node "<scratchpad>/receipt-types.check.ts"` → module not found.

- [ ] **Step 3: Implement `receipt-types.ts`**

Ranking for `suggestExpenseMatches` — sort key tuple, ascending:
```
exact = e.currency === reading.currency && e.amountCents === reading.totalCents
dayGap = both dates present ? |days between| : 99
amountGap = same currency && totalCents != null ? |e.amountCents - totalCents| : Infinity
key = [exact ? 0 : 1, dayGap, amountGap]
```
Filter first: `!e.isSettlement && !receiptExpenseIds.has(e.id)`, and drop candidates with `!exact && dayGap > 2`. Take 3.

- [ ] **Step 4: Run the check, expect pass.** Then `pnpm lint` and `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/receipt-types.ts
git commit -m "feat(receipts): types, read state and match suggestions"
```

---

### Task 3: The read-receipt agent

**Files:**
- Modify: `src/lib/ai/registry.ts` (add tool `submit_receipt`)
- Create: `src/lib/ai/agents/read-receipt.ts`
- Modify: `src/lib/ai/claude.ts` (re-export)

**Interfaces:**
- Consumes: `ReceiptReading`, `ReceiptMime` from Task 2; `runAgent`, `AgentDescriptor` from `src/lib/ai/runtime.ts`.
- Produces: `export function readReceiptFile(file: { base64: string; mimeType: ReceiptMime }): Promise<ReceiptReading>` (throws when no tool block is returned), re-exported from `@/lib/ai/claude`.

- [ ] **Step 1: Add `submit_receipt`** to `TOOL_REGISTRY`, `strict: true`, `additionalProperties: false`, every field of `ReceiptReading` required, nullable fields as `type: ["string","null"]` / `["integer","null"]`, amounts in integer cents, date as `yyyy-mm-dd`.

- [ ] **Step 2: Write the descriptor** following `agents/suggestion.ts`: `name: "read-receipt"`, `model: "claude-haiku-5-5"`, `maxTokens: 4096`, `tools: ["submit_receipt"]`, **no `toolChoice`** (forced tool choice is rejected by the newest models; the system prompt says "Always answer by calling submit_receipt"), `mcpServers: []`. `buildInput` returns one user message: an `image` block (`source: {type:"base64", media_type, data}`) or a `document` block for PDF, then a short text block. System prompt: read what is printed, never guess; null for anything not shown; currency from symbols/country only when clear; `summary` is one short line ("Groceries at Pingo Doce, Funchal"). `parseOutput` finds the `submit_receipt` tool block or throws `"No receipt reading returned"`.

- [ ] **Step 3: Re-export** `readReceiptFile` from `claude.ts`.

- [ ] **Step 4: Verify** — `pnpm lint`, `pnpm exec tsc --noEmit` clean. Then one real call: a scratch script is not possible (server-only import); instead defer the live check to Task 4's action and the user's in-app check 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/registry.ts src/lib/ai/agents/read-receipt.ts src/lib/ai/claude.ts
git commit -m "feat(ai): read-receipt agent on Haiku 5.5"
```

---

### Task 4: Queries and server actions

**Files:**
- Create: `src/lib/trips/receipt-queries.ts`
- Create: `src/lib/trips/receipt-actions.ts` (`"use server"`)
- Modify: `src/lib/trips/actions.ts` — `LogExpenseResult` gains `expenseId?: string`; `logExpense` inserts with `.select("id").single()` and returns it; `deleteTrip` removes storage objects first.

**Interfaces:**
- Consumes: Task 2 types; `readReceiptFile` (Task 3); `createClient` from `@/lib/supabase/server`.
- Produces:
  ```ts
  // receipt-queries.ts
  export async function getTripReceipts(tripId: string): Promise<Receipt[]>   // newest first, signed URLs (1 h) via one createSignedUrls call
  // receipt-actions.ts — all return { error?: string }
  export async function addReceipt(input: { tripId: string; tripSlug: string; receiptId: string; storagePath: string; mimeType: ReceiptMime; expenseId: string | null }): Promise<{ error?: string }>
  export async function readReceipt(receiptId: string, tripSlug: string): Promise<{ error?: string }>
  export async function attachReceipt(receiptId: string, expenseId: string | null, tripSlug: string): Promise<{ error?: string }>
  export async function deleteReceipt(receiptId: string, tripSlug: string): Promise<{ error?: string }>
  ```

- [ ] **Step 1: `getTripReceipts`** — select the row columns, map snake→camel, then `supabase.storage.from("receipts").createSignedUrls(paths, 3600)` and attach `url`.

- [ ] **Step 2: Actions**
  - `addReceipt`: insert row (`id: receiptId`, `read_status: "pending"`), then `await readReceipt(...)`'s body (shared private helper `runRead(supabase, receiptId)`), `revalidatePath("/trips/" + tripSlug)` and `revalidatePath("/on-the-road")`.
  - `runRead`: select `storage_path, mime_type`; `storage.from("receipts").download(path)`; base64 via `Buffer.from(await blob.arrayBuffer()).toString("base64")`; `readReceiptFile`; update `reading` + `read_status: "done"`. On any thrown error update `read_status: "failed"` and return `{ error: "Couldn't read this receipt." }`.
  - `readReceipt` ("read again"): runs `runRead` and revalidates. It does not reset `read_status` or `created_at`; the button shows its own pending state from `useTransition` while the action runs. If that request dies, the row keeps its old status and the card still offers "read again".
  - `attachReceipt`: update `expense_id` (RLS enforces same trip).
  - `deleteReceipt`: select path, `storage.from("receipts").remove([path])`, delete row.
  - `deleteTrip` (in `actions.ts`): before deleting the trip, `list(tripId)` in the bucket and `remove` the returned paths (`${tripId}/${name}`). List returns up to 100 by default — pass `{ limit: 1000 }`.

- [ ] **Step 3: `logExpense` returns `{ expenseId }`** on success. Existing callers ignore it; no other change.

- [ ] **Step 4: Verify** — `pnpm lint`, `pnpm exec tsc --noEmit` clean. Reason through RLS: every call uses the server client (user session), so a non-member's insert/select/download is refused by Task 1 policies.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/receipt-queries.ts src/lib/trips/receipt-actions.ts src/lib/trips/actions.ts
git commit -m "feat(receipts): queries, actions, file cleanup on trip delete"
```

---

### Task 5: Browser upload helper

**Files:**
- Create: `src/lib/trips/receipt-upload.ts` (client-only module; no `"use server"`, no `next/headers`)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`; `addReceipt` (Task 4); `RECEIPT_MIMES`, `RECEIPT_PDF_MAX_BYTES` (Task 2).
- Produces:
  ```ts
  export function checkReceiptFile(file: File): string | null          // error text or null
  export async function shrinkImage(file: File): Promise<Blob>          // JPEG, longest edge ≤ 1600
  export async function uploadReceipt(input: { tripId: string; tripSlug: string; file: File; expenseId: string | null }): Promise<{ error?: string }>
  ```

- [ ] **Step 1: `checkReceiptFile`** — error `"Use a photo (JPEG, PNG, WebP) or a PDF."` when type not in `RECEIPT_MIMES`; `"PDF is over 10 MB."` when a PDF exceeds the cap. Images have no cap (they are shrunk).

- [ ] **Step 2: `shrinkImage`** — `createImageBitmap(file, { imageOrientation: "from-image" })`, scale so the longest edge ≤ 1600 (never upscale), draw to an `OffscreenCanvas`, `convertToBlob({ type: "image/jpeg", quality: 0.82 })`.

- [ ] **Step 3: `uploadReceipt`** — check → id `crypto.randomUUID()` → body = PDF as-is or shrunk JPEG → path `${tripId}/${id}.${pdf ? "pdf" : "jpg"}` → `storage.from("receipts").upload(path, body, { contentType })`; on upload error return `{ error: "Upload failed, receipt not saved." }` without calling the action → `addReceipt({... mimeType: pdf ? "application/pdf" : "image/jpeg" })`.

- [ ] **Step 4: Verify** — lint + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/receipt-upload.ts
git commit -m "feat(receipts): browser upload with image shrinking"
```

---

### Task 6: Pile, receipt view and add button

**Files:**
- Create: `src/components/receipts/add-receipts-button.tsx`
- Create: `src/components/receipts/receipt-pile.tsx`
- Create: `src/components/receipts/receipt-view.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (prop `receipts: Receipt[]`, render button + pile above the ledger)
- Modify: `src/app/trips/[slug]/page.tsx` (load `getTripReceipts` when `wants("budget")`, pass to `BudgetTab`)
- Modify: `src/app/on-the-road/page.tsx` (load receipts, render button + pile below `QuickExpense`)

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces:
  ```ts
  AddReceiptsButton(props: { tripId: string; tripSlug: string; expenseId?: string | null; label?: string })
  ReceiptPile(props: { tripSlug: string; receipts: Receipt[]; expenses: Expense[]; nowMs: number })  // renders unmatched only; null when none
  ReceiptView(props: { receipt: Receipt; tripSlug: string; expenses?: Expense[]; receiptExpenseIds?: Set<string>; open: boolean; onOpenChange: (o: boolean) => void })
  ```

- [ ] **Step 1: `AddReceiptsButton`** — hidden `<input type="file" multiple accept="image/*,application/pdf">` behind a button styled like the existing mono-caps pills. Uploads files sequentially with `uploadReceipt`, shows "adding 2/3…" then errors inline (one line per failed file name), then `router.refresh()`.

- [ ] **Step 2: `ReceiptPile`** — list of cards for receipts with `expenseId === null`: thumbnail (`<img src={url}>`, or a "PDF" tile), then per `receiptState`: `reading…` / `couldn't read` + "read again" (calls `readReceipt`) / merchant · `en-GB` date · `money(totalCents, currency)`. Tapping a card opens `ReceiptView`. `nowMs` comes from the server render (no `Date.now()` in render).

- [ ] **Step 3: `ReceiptView`** — `Dialog` from `@/components/ui/dialog`: image (or link "open PDF" to `url`), the read text (merchant, date, items, total, summary), and when `expenses` is given and the receipt is unmatched: up to 3 `suggestExpenseMatches` rows + a `<select>` "pick another expense" over all non-settlement expenses; choosing calls `attachReceipt`. When matched: "detach" (`attachReceipt(id, null)`) and "delete" (`deleteReceipt`). `router.refresh()` after each.

- [ ] **Step 4: Mount** in budget tab and on-the-road page as listed above.

- [ ] **Step 5: Verify** — lint + tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/receipts src/app/trips/[slug]/budget-tab.tsx src/app/trips/[slug]/page.tsx src/app/on-the-road/page.tsx
git commit -m "feat(receipts): pile, receipt view and add button"
```

---

### Task 7: Quick-expense camera and ledger marker

**Files:**
- Modify: `src/app/on-the-road/quick-expense.tsx`
- Modify: `src/app/trips/[slug]/budget-ledger.tsx` and `src/app/trips/[slug]/ledger-row.tsx` (pass `receipts: Receipt[]` for the row; marker in `LedgerRowView`)

**Interfaces:**
- Consumes: `uploadReceipt` (Task 5), `logExpense` returning `expenseId` (Task 4), `ReceiptView` (Task 6).

- [ ] **Step 1: Quick-expense** — a small camera button left of "add" opening a hidden `<input type="file" accept="image/*,application/pdf" capture="environment">`; holds one `File` (button shows it is held; tap again to clear). On submit, after `logExpense` succeeds and returns `expenseId`, call `uploadReceipt({ ..., expenseId })`. If upload fails, keep the expense and show `"Expense saved; receipt not saved — add it from the pile."` Run `checkReceiptFile` on pick and show its error immediately.

- [ ] **Step 2: Ledger marker** — `Ledger` builds `Map<expenseId, Receipt[]>` from a new `receipts` prop (passed down from `BudgetTab`); `LedgerRowView` shows a small "receipt" / "2 receipts" mono label when non-empty; tapping opens `ReceiptView` for the first (with detach/delete). *Plan note:* the spec's "itinerary event expense" is a create form, not a row with an existing expense, so it gets no marker.

- [ ] **Step 3: Verify** — lint + tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/quick-expense.tsx src/app/trips/[slug]/budget-ledger.tsx src/app/trips/[slug]/ledger-row.tsx src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(receipts): snap with expense, receipt marker on ledger rows"
```

---

### Task 8: Build, docs, hand-over

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1:** Confirm the dev server is not running (ask the user if unsure). Run `pnpm build` → success; `pnpm lint` → clean.
- [ ] **Step 2:** `docs/TODO.md`: receipts *implemented, unverified in app*; add "create expense from receipt" as the next queued item. `docs/DECISIONS.md` rows: files go browser→Storage (1 MB server-action cap); read on upload with Haiku 5.5 (cost); `read_status` with 2-minute staleness; `uploaded_by` references `auth.users`, not `workspace_people`; tool-call output without forced `tool_choice`.
- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: receipts in TODO and DECISIONS"
```

- [ ] **Step 4: Hand over** — report "implemented; build and lint clean; unverified in app", with the spec's in-app checklist (items 1–7) plus: paste the migration twice without error.
