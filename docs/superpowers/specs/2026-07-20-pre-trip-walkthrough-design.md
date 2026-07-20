# Before-you-go walkthrough — design

**Date:** 2026-07-20
**Status:** Approved, ready for planning

## Problem

The "Before you go" card (shipped 2026-07-17) shows all five fixed pre-trip
slots — Flights, Travel insurance, Docs & fees, Medicine/vaccinations, Gear —
as blocks at once, with one Save at the bottom. It works, but it reads as a
dense form. The budget planner right below it is a friendlier **guided walk**:
one question per step, back/next, a review with the total. We want the
before-you-go card to feel like that walk.

## What we're building

Rewrite `pre-trip-checklist.tsx` as a **stepper**, reusing the budget planner's
(`budget-drafter.tsx`) guided-questions chrome and row shape as closely as
possible. Only strip what pre-trip doesn't need.

This is a **UI-only change.** The data model, the reserved `"Pre-trip"`
category, and the `savePreTripItems` server action are all unchanged. The card
still lives in the same place in `budget-tab.tsx`, which is untouched — it
already just renders `<PreTripChecklist>`.

### Guiding principle

Take the planner's design and adjust; do not redesign from scratch. Where the
planner already answers a question (header layout, footer buttons, row visual,
review layout, collapsed-entry pattern), match it.

## Behavior

### Collapsed entry (default state)

Like the planner, the card starts collapsed to a single button:

- `Fill before-you-go` when no `"Pre-trip"` items exist yet
- `Edit before-you-go` once they do

Clicking opens the walkthrough at step 1. There is **no "Start over"** button —
unlike the budget, pre-trip has no second seed mode (the five fixed slots *are*
the seed). The Pre-trip total keeps showing in the category breakdown, so
collapsing hides nothing.

### Steps 1–5 — the fixed slots

One slot per step, in the existing order: Flights / getting there · Travel
insurance · Docs & fees · Medicine / vaccinations · Gear & equipment. Each step
mirrors the planner's `renderStep`:

- header row: a small `Label` on the left, `step N of 7` on the right
- serif-italic title = the slot name (the headline)
- **one or more rows**, each the planner's `renderRow` stripped down to just: a
  free-text note line with the `€` price to the right, and an `x` to remove it.
  No freq toggle (once/×n/daily), no date pickers, no est./source marks.
- an **`+ add <noun>`** button below the rows (e.g. "add flight", "add policy")
  so a slot can hold several entries — one flight per leg, several gear items, etc.
- `back / cancel / next` footer. `back` is disabled on step 1; `cancel`
  collapses back to the button without saving.

The slot label is plain text (a known slot, not editable) and is shared by every
entry under it. Entries differ by their note + amount. Leaving a slot's rows
blank is fine; blank rows are skipped on save.

Nouns per slot: Flights → *flight*, Travel insurance → *policy*, Docs & fees →
*doc*, Medicine → *item*, Gear → *item*.

### Step 6 — "Anything else?"

Editable-subject rows with `+ add item` for extras beyond the five, each with a
removable `x`. This is where today's `+ add item` capability moves. Back/next
footer.

### Step 7 — Review

Mirrors the planner's `renderReview`, minus the AI parts (no generate, no
est./source, no price-unknown):

- every non-empty line listed with its amount
- **Pre-trip total** at the bottom
- `apply` (saves via `savePreTripItems`, then collapses to the button) +
  `cancel`. Also `back` to the previous step.

## Data model & save

Unchanged action. On open, seed rows from `budgetItems` where
`category === "Pre-trip"`: **group** saved items under the five slots by subject
(every entry under a slot shares the slot label as its subject, so a slot can now
map to several rows), surface unmatched saved items as "Anything else?" rows. A
slot with no saved items starts with one empty row.

`apply` builds the same `SaveBudgetItemInput[]` the current `save()` builds
(amount > 0 and non-empty subject) and calls the existing `savePreTripItems`.
No action or type changes.

## Row model

Reuse the existing `Row` type (`id`, `itemId?`, `subject`, `note`, `value`,
`fixed`). The stepper renders one `Row` per step for the five fixed slots, and
the "Anything else?" step renders the added (`fixed: false`) rows.

## Both modes (planning vs on the road)

No mode-specific behavior — the Budget tab renders identically in each. Pre-trip
is a planning-mode tool by nature; on the road the walk still opens and the
saved costs remain payable via the category breakdown. Same as the current card.

## Out of scope

- No changes to `savePreTripItems`, `SaveBudgetItemsInput`, or the DB.
- No changes to `budget-tab.tsx` (it renders the component as-is).
- No AI, no generate/pricing on this surface.
- No new slots; the five are unchanged.

## Touched files

- **Rewrite:** `src/app/trips/[slug]/pre-trip-checklist.tsx` (stepper)
- **Docs:** append a row to `docs/DECISIONS.md`; update `docs/TODO.md`

No migration required.
