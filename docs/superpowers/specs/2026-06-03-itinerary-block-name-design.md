# Itinerary block name — design

**Date:** 2026-06-03
**Status:** approved

## Problem

When you add a 2+ day span to the dated itinerary, the days share a `group_id`
and render inside a rounded border with a hardcoded caption that reads
**"added together"** (`itinerary-tab.tsx`). There is no way to name the block —
e.g. label a 3-day span "Rinjani Trek". The caption is fixed text and no name is
stored anywhere.

## Goal

Let you name a multi-day block **when you create it**. In the Add-a-day form, a
"Block name" field appears only when you extend the dates (set a "to" date that
makes a 2+ day span). The name is stamped on every day of the span. The block
caption then shows that name, falling back to "added together" when blank.

## Scope

Dated itinerary only (`itinerary_days`). The dream itinerary is unchanged.

- Naming happens **only in the Add-a-day form**, only when a span is created.
- The caption is **display-only** — not click-to-edit. (No rename action, no
  inline-edit UI.)
- A single-day add never shows the block-name field and stores no name.

## Approach (chosen)

**Denormalized `group_name` column on `itinerary_days`.** When the Add form
creates a span, every inserted row gets the same `group_name` (alongside the
shared `group_id` it already stamps). Chosen over a normalized
`itinerary_groups` table because it reuses everything already in place —
existing RLS, the existing `itinerary_days` Realtime channel (so the named span
propagates to the partner for free), and the existing query/insert path. The
name lives only on the span's rows; nothing else changes.

## Design

### Schema

Idempotent migration adding one nullable column:

```sql
alter table public.itinerary_days
  add column if not exists group_name text;
```

No index, no constraint, inherits the table's existing RLS.

### Action

`addItineraryDay` (in `actions.ts`) gains an optional `groupName` on
`AddItineraryDayInput`:

- The span branch already computes `groupId = dates.length > 1 ? randomUUID()
  : null`. Add a parallel `const groupName = dates.length > 1 ?
  (input.groupName?.trim() || null) : null` — only spans carry a name; a blank
  field stores `null`.
- Each row in the bulk insert gets `group_name: groupName`.
- The insert `.select(...)` adds `group_name` so the optimistic/return path
  stays consistent.

No new action is added.

### Threading the field

`group_name` flows through the same path `group_id` already does:

- `ItineraryRow` / `ItineraryDay` gain `groupName: string | null`.
- `rowToItineraryDay` maps `row.group_name ?? null`.
- The itinerary query `.select(...)` in `itinerary-queries.ts` adds
  `group_name`.
- `RealtimeRow` in `itinerary-tab.tsx` adds `group_name: string | null`.

### UI — Add form

In `DayForm` (Add mode, i.e. `setEndDate` present), add an optional **Block
name** text field that is shown **only when `endDate` is set** (a span is being
created). `AddDayRow` holds the new `groupName` state and passes it through;
`reset()` clears it. The field is plain text, optional, no validation beyond the
trim the action does.

### UI — caption

In the multi-day segment branch (`seg.groupId && seg.days.length > 1`), replace
the fixed `"added together"` text with `seg.days[0].groupName ?? "added
together"`. Style a real name slightly more prominently than the muted
placeholder. Still display-only — no button, no input.

## Edge behavior

- Editing or deleting individual days keeps the name (it is on every remaining
  row); the caption survives as long as one row of the group remains.
- Pre-existing spans have `group_name = null` and show the "added together"
  placeholder — no data migration needed.
- A run that drops to a single day no longer shows the caption, so its
  `group_name`, if any, is simply not displayed; harmless.
- Leaving the field blank on a span keeps today's behaviour exactly.

## Out of scope

- Renaming or inline-editing a block after creation.
- A normalized groups table.
- Naming dream-itinerary multi-adds.
