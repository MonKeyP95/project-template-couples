# Receipt attachments — design

**Date:** 2026-10-22
**Status:** approved, not implemented

## Why

On a trip you pay for things and later can't remember what the money went on.
A receipt is the record behind an expense. Keep the photo (or PDF) as proof,
and have it read into text so you can see shop, date, items and total without
opening the picture.

## Goals

- Attach receipt photos and PDFs to expenses.
- Add receipts to a per-trip **pile** before any expense exists, and match them
  to expenses later.
- Every receipt is read on upload by Claude into structured, readable text.
- Works in both modes: **on the road** (snap at the counter, one-handed, on
  roaming data) and **planning** (hotel/flight confirmation PDFs before the
  trip, or catching up on a batch afterwards).

## Non-goals (this slice)

- **Creating the expense from the receipt.** Wanted later, deliberately
  deferred. This slice must leave a clear place for it (see "Later").
- Forwarding emails into the app (needs an inbound mail address — a new
  subsystem). Save the email as a PDF or screenshot instead.
- Automatic matching. The app suggests; the user always confirms.
- Realtime sync of receipts between partners. A page refresh is enough.
- Editing the read text by hand.

## Anti-goals

- Reading that silently changes an expense's amount, date or category. The
  read text is shown next to the expense; it never rewrites it.
- An upload flow slow or fiddly enough that you skip it at the counter.

## User decisions (from the brainstorm)

| Decision | Choice |
|---|---|
| Who creates the expense | The user, as today. Receipt only attaches. |
| When is it read | Automatically on upload (cost is ~$0.0007 per photo on Haiku 5.5, so no reason to gate behind a tap). |
| File types | Photos and PDFs. |
| Pile | Yes — receipts can exist with no expense, matched later. |
| Counter flow | Both: attach a receipt inside the quick-expense box at the moment of logging, **or** drop it in the pile. |

## Data model

New table `public.receipts` (one migration, re-runnable):

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `trip_id uuid not null` → `trips(id) on delete cascade` | |
| `expense_id uuid null` → `expenses(id) on delete set null` | Null = in the pile. Deleting an expense returns its receipts to the pile. |
| `storage_path text not null` | Object path in the bucket. |
| `mime_type text not null` | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. |
| `uploaded_by uuid not null` | Same reference style as `expenses.paid_by` after `20260802000002_workspace_people.sql` — builder checks which table that now points at. |
| `read_status text not null default 'pending'` | `pending` / `done` / `failed`. *My call.* A `pending` row older than 2 minutes is shown as failed (the reading browser may have closed), so anyone can press "read again". |
| `reading jsonb null` | Set when `read_status = 'done'`. Shape below. |
| `created_at timestamptz default now()` | |

Cardinality: an expense can have many receipts (multi-page bill); a receipt
belongs to at most one expense.

RLS: select/insert/update/delete for `public.is_trip_workspace_member(trip_id)`,
same as `expenses`. Update must also only allow `expense_id` values whose
expense is on the same trip.

`reading` shape (the "readable file" — my call: stored on the row, rendered as
a card, not a separate text file in storage):

```json
{
  "merchant": "Pingo Doce",
  "date": "2026-10-14",
  "totalCents": 2340,
  "currency": "EUR",
  "items": [{ "label": "Bread", "amountCents": 120 }],
  "summary": "Groceries at Pingo Doce, Funchal"
}
```

Every field may be null when the receipt doesn't show it. Amounts in cents to
match `expenses.amount_cents`.

## Storage

- First use of Supabase Storage in the app. One **private** bucket, `receipts`,
  created in the migration (`insert into storage.buckets ... on conflict do nothing`).
- Path: `{trip_id}/{receipt_id}.{ext}`. Storage RLS on `storage.objects` reads
  the trip id from the first path segment and checks
  `is_trip_workspace_member`.
- Shown via short-lived signed URLs, generated server-side when the page loads.
- **Upload goes browser → Storage directly** with the browser Supabase client,
  not through a server action: server actions cap bodies at 1 MB by default
  and phone photos exceed that. Sequence (*my call*, so a row never exists
  without its file): browser makes the receipt id (`crypto.randomUUID()`) →
  uploads to `{trip_id}/{id}.{ext}` → calls a server action that inserts the
  row and runs the read. A failed insert leaves an orphan file; accepted.
- **File cleanup** (*my call*): deleting a receipt deletes its object;
  `deleteTrip` also removes every object under `{trip_id}/`. Postgres cascades
  don't touch Storage, so this is done in the actions.
- Photos are shrunk in the browser before upload (longest edge ~1600 px, JPEG).
  PDFs upload as-is with a 10 MB cap.

## Reading

- New agent descriptor `src/lib/ai/agents/read-receipt.ts`, run through
  `runAgent`, exported via `src/lib/ai/claude.ts`. Model `claude-haiku-5-5`.
- Input: the file as an `image` or `document` (PDF) content block, base64,
  fetched server-side from Storage. `buildInput` already accepts
  `MessageParam[]`, so no runtime change is needed for the input.
- Output: the `reading` JSON above. Existing agents get JSON through a forced
  tool call; newer models may reject forced `tool_choice`. Builder checks
  whether Haiku 5.5 accepts it, and if not uses structured outputs
  (`output_config.format`) or `auto` + `strict` tool — whichever needs the
  smallest change to `runAgent`.
- Server action `readReceipt(receiptId)` writes `reading`. On failure the card
  shows "couldn't read" with a "read again" button; the photo is still saved.

## UI

All mobile-first; desktop gets the same components in the existing budget
tab.

1. **Quick-expense box** (`src/app/on-the-road/quick-expense.tsx`): a camera
   button next to "add". Picking a file holds it; on submit the expense is
   logged, then the receipt is uploaded already attached to the new expense.
   `logExpense` must return the new expense id.
2. **Add to pile**: an "add receipts" button that accepts several files at
   once (camera, library, files). Lives on the on-the-road page and in the
   budget area (the Budget box on the mobile one-page trip, the budget tab on
   desktop).
3. **Pile**: a list of unmatched receipt cards — thumbnail (or PDF icon),
   merchant, date, total, or "reading..." / "couldn't read". Shown in **both**
   the budget area and the on-the-road page (user decision), as one shared
   component. Shown only when the pile is non-empty.
4. **Matching**: opening a pile card shows the full read text, the image, and
   up to 3 suggested expenses plus "pick another expense". Tapping one attaches.
5. **Expense rows** (ledger row, itinerary event expense): a small receipt
   marker with count when receipts are attached. Tapping opens the receipt
   view (image/PDF + read text) with "detach" (back to pile) and "delete".

## Match suggestions

Pure function, no AI, in a `*-types.ts`-style module so client components can
import it: `suggestExpenseMatches(reading, expenses)` →
up to 3 expenses, ranked. A candidate must be a non-settlement expense on the
trip that has **no receipt yet** (*my call*: keeps the top 3 useful on a busy
trip; a second page of a bill goes on via "pick another expense"). Expenses
with a null `day_date` rank by amount only. Rank: same currency and exact amount first,
then date distance (0, ±1, ±2 days), then amount closeness. If the reading has
no total and no date, return none.

## Later: create expense from receipt

A pile card gains "create expense from this", prefilling the quick-expense
fields from `reading` for the user to confirm. Nothing in this slice blocks it;
`reading` already carries the needed fields. Category guessing would be the
only new AI step.

## Left to the builder

- Exact placement and styling of buttons/cards within `DESIGN.md`.
- Thumbnail approach (signed URL of the original is fine).
- HEIC handling: iOS file inputs normally hand over JPEG; verify and convert
  only if not.
- The read prompt wording.

## Success criteria

**Verified by Claude**
1. `pnpm build` and `pnpm lint` pass.
2. Migration runs twice in a row in the SQL editor without error (re-runnable).
3. RLS: a user not in the trip's workspace gets 0 rows from `receipts` and
   cannot read/write objects under that trip's path (reasoned from policies).
4. `suggestExpenseMatches` returns an exact amount+same-day expense first, and
   `[]` for a reading with no total and no date.
5. `read-receipt` descriptor uses `claude-haiku-5-5` and is the only new model
   call; it goes through `runAgent`.
6. No upload path passes file bytes through a server action.
7. Deleting an expense leaves its receipts with `expense_id = null`.

**Verified by the user in-app**
1. On a phone, in quick-expense: snap a receipt, add the expense; the expense
   row shows a receipt marker.
2. Add three photos at once to the pile; each shows "reading..." then merchant,
   date and total.
3. Add a hotel booking PDF to the pile; it gets read.
4. Open a pile card; the right expense appears among the suggestions; attach
   it; it leaves the pile and shows on the expense.
5. Partner, on their own phone after refresh, sees the same receipt and photo.
6. Detach a receipt; it returns to the pile.
7. Upload a 4 MB phone photo on mobile data; it finishes in reasonable time.
