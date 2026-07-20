# Before-you-go walkthrough — implementation plan

Spec: `docs/superpowers/specs/2026-07-20-pre-trip-walkthrough-design.md`

UI-only rewrite of `src/app/trips/[slug]/pre-trip-checklist.tsx` into a stepper
that mirrors `budget-drafter.tsx`. No action, type, DB, or `budget-tab.tsx`
change.

## Step 1 — Rewrite the component as a stepper

File: `src/app/trips/[slug]/pre-trip-checklist.tsx`

Keep the top of the file as-is:
- `PRE_TRIP_CATEGORY`, `SLOTS`, `fmt`, `asCents`, `Row`, `PreTripChecklistProps`.
- The `useState` seed initializer (slot matching + added rows) is unchanged.
- `patch`, `addRow`, `removeRow`, `save`, and the `total` derivation are unchanged.

Add stepper state and structure:

- `const [open, setOpen] = React.useState(false)` — collapsed vs. walkthrough.
- `const [stepIndex, setStepIndex] = React.useState(0)`.
- Steps: indices `0..4` = the five fixed slots (`rows` filtered to `fixed`),
  index `5` = "Anything else?" (the `!fixed` added rows), index `6` = review.
  Total 7 steps. Define `const STEP_COUNT = SLOTS.length + 2`.
- Helper `fixedRows = rows.filter(r => r.fixed)` and
  `addedRows = rows.filter(r => !r.fixed)` derived at render.

### Collapsed render (when `!open`)

Mirror the drafter's collapsed block: a bordered strip with one button.

```tsx
if (!open) {
  const hasItems = rows.some((r) => asCents(r.value) > 0)
  return (
    <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-3">
      <button
        type="button"
        onClick={() => { setStepIndex(0); setOpen(true) }}
        className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        {hasItems ? "Edit before-you-go" : "Fill before-you-go"}
      </button>
      <span className="t-num font-mono text-[13px] text-muted-foreground">€{fmt(total)}</span>
    </div>
  )
}
```

### Walkthrough render (when `open`)

Wrap in the drafter's card shell and switch on `stepIndex`:

```tsx
return (
  <div className="border-t border-border px-5 pt-4 pb-4">
    <div className="rounded-lg border border-border bg-card px-3.5 py-3">
      {stepIndex < SLOTS.length
        ? renderSlotStep(fixedRows[stepIndex], stepIndex)
        : stepIndex === SLOTS.length
          ? renderExtrasStep(addedRows)
          : renderReview()}
    </div>
  </div>
)
```

### `renderSlotStep(row, i)`

- header: `<Label>before you go</Label>` left, `step {i + 1} of {STEP_COUNT}` right
  (same classes as the drafter's step header).
- serif-italic title = `row.subject` (the slot label).
- one row body = the **stripped row**: note input (free text) + `€` + number
  input, using the exact input classes from the current component's note/value
  inputs. No `x`, no freq, no dates.
- footer: `back` (disabled when `i === 0`, goes `stepIndex-1`), `cancel`
  (`setOpen(false)`), `next` (`stepIndex+1`). Same footer classes as the drafter.

### `renderExtrasStep(addedRows)`

- header: `<Label>before you go</Label>` left, `step {SLOTS.length + 1} of {STEP_COUNT}` right.
- serif-italic title = `Anything else?`.
- map `addedRows` to a row with an **editable subject** input + `x` (removeRow),
  note input, `€` + number input — reuse the current component's added-row JSX.
- `+ add item` button (calls `addRow`), same dashed-pill classes as today.
- footer: `back` (→ last slot, `SLOTS.length - 1`), `cancel`, `next` (→ review).

### `renderReview()`

- header: `<Label>before you go</Label>` left, `back` (→ extras step) right.
- list every row with `asCents(r.value) > 0`: subject on the left (slot label or
  typed subject), `€{fmt(asCents(r.value))}` on the right; show the note in muted
  mono if present. Reuse the drafter review line layout, minus est./source/×qty.
- total line: `Pre-trip` label + `€{fmt(total)}`.
- footer: `apply` (calls `save()`; on success collapse via `setOpen(false)`) +
  `cancel` (`setOpen(false)`). Keep the existing `error` display.
  - `save()` today runs in a transition and sets `error`; make `apply` close the
    walkthrough only when there's no error. Simplest: after `startTransition`
    resolves with no error, `setOpen(false)`. Fold the close into the existing
    `save` by adding `setOpen(false)` in the `res.error ? ... : setOpen(false)`
    branch inside the transition callback.

Remove the old always-open block layout (the `rows.map` card list, the bottom
`+ add item` / `save` row, and the old total footer) — those move into the steps
above.

## Step 2 — Validate

- `pnpm lint`
- `pnpm build`
- Manual: open the trip's Budget tab. The "Before you go" card shows a button.
  Click it → step 1 (Flights). Next through the five slots, add an extra on
  "Anything else?", review shows the total, apply saves and collapses. Reopen →
  values persisted, button reads "Edit before-you-go".

## Step 3 — Docs

- `docs/TODO.md`: note the before-you-go card is now a guided walkthrough.
- `docs/DECISIONS.md`: append a row — before-you-go reshaped from a flat 5-block
  form into a planner-style stepper for consistency; UI-only, action unchanged.

## Notes

- React 19 lint: the `step N of M` text and `Anything else?` are plain strings,
  no `//`-in-JSX gotcha. Edit-in-place local state is already handled by the
  existing `Row` state; no `useEffect` reset needed.
- No subagents; single-file edit on a possibly-dirty tree — controller does git.
