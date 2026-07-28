# Edit-Trip Profile Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/trips/[slug]/edit` the same one-question-per-screen profile walkthrough that `/trips/new` has, with back/next navigation, by extracting the stepper both pages can share.

**Architecture:** A new controlled component `ProfileWalkthrough` owns only the current step index; the parent page owns every profile value and its own save. `/trips/new` passes two optional slots (a review screen and a create button) so its behavior is unchanged; `/trips/[slug]/edit` passes neither and keeps its existing always-enabled `save changes` footer below the walkthrough.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. No new dependencies, no migration, no server-action change.

Spec: `docs/superpowers/specs/2026-07-28-edit-trip-walkthrough-design.md`

## Global Constraints

- **No commits in this plan.** The working tree carries unrelated uncommitted work (the `vibeNote` slice across `src/lib/trips/actions.ts`, `src/lib/trips/trip-profile-types.ts`, `src/lib/ai/profile-context.ts`, and both trip forms). A `git add` of either form file would sweep it in. Verify with lint + build; leave committing to the user.
- **No new dependencies, no migration, no server-action signature change.** `createTrip` and `updateTrip` are not touched.
- **No emojis** in code, output, or logs.
- **Sparse comments.** Docstring-style comment on the exported component only; the existing files' density is the target.
- Verification command after every code task: `pnpm lint` then `pnpm build`, both clean.
- There is no test suite in this repo. Do not invent one. Verification is lint, build, and the in-app checklist in Task 4.
- Display dates day-before-month (`en-GB`). Not exercised here, but do not introduce `en-US`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/trips/profile-walkthrough.tsx` | The four profile questions as a stepper: header, step body, back/next footer. Controlled. | **Create** |
| `src/app/trips/profile-fields.tsx` | Shared presentational pieces (`OptionRow`, `CategoryCard`, `StepShell`, `LocalCategoryEditor`). | Unchanged — consumed by the new file |
| `src/app/trips/new/new-trip-form.tsx` | Create page: basics form + walkthrough + review + create action. | **Modify** — stepper JSX replaced by the component |
| `src/app/trips/[slug]/edit/edit-trip-form.tsx` | Edit page: basics form + walkthrough + save/delete. | **Modify** — flat profile section replaced by the component |
| `docs/DECISIONS.md` | Decision log. | **Modify** — supersede the 2026-07-22 flat-edit row, add today's |
| `docs/TODO.md` | Task log. | **Modify** — add the entry |

---

### Task 1: The shared walkthrough component

**Files:**
- Create: `src/app/trips/profile-walkthrough.tsx`

**Interfaces:**
- Consumes: `OptionRow`, `StepShell`, `LocalCategoryEditor`, `type LocalCategory` from `./profile-fields`; `TRIP_TRANSPORT`, `TRIP_VIBES` from `@/lib/trips/trip-profile-types`.
- Produces:
  - `interface ProfileWalkthroughValue { idea: string; vibe: string[]; vibeNote: string; transport: string[]; categories: LocalCategory[] }`
  - `function ProfileWalkthrough(props: { value: ProfileWalkthroughValue; onChange: (patch: Partial<ProfileWalkthroughValue>) => void; disabled?: boolean; extraStep?: React.ReactNode; footerAside?: React.ReactNode; finalAction?: React.ReactNode })`

**Notes for the implementer:**

Three optional slots, each with one job. `extraStep` appends a fifth screen (create's review recap). `footerAside` renders on the right of the footer on **every** step, before the next/final button (create's `cancel` — it must not disappear on steps 1-4). `finalAction` replaces the `next` button once the last screen is showing (create's `create trip` button). Edit passes none of the three.

The step markup below is lifted verbatim from the current `new-trip-form.tsx` lines 245-411, with two deliberate deltas:

1. `autoFocus` is **dropped** from the step-0 textarea. On create it is already overridden — the page's `useEffect` focuses the name input after mount — so create is unaffected. On edit it would steal focus on load and scroll the page past the basics.
2. Values and setters come from `value` / `onChange` instead of local state.

- [ ] **Step 1: Create the file**

```tsx
"use client"

import * as React from "react"

import {
  LocalCategoryEditor,
  OptionRow,
  StepShell,
  type LocalCategory,
} from "./profile-fields"
import { TRIP_TRANSPORT, TRIP_VIBES } from "@/lib/trips/trip-profile-types"

const PROFILE_STEP_COUNT = 4

export interface ProfileWalkthroughValue {
  idea: string
  vibe: string[]
  vibeNote: string
  transport: string[]
  categories: LocalCategory[]
}

function toggled(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
}

/** The trip-profile questions as a stepper — one question per screen, back and
 * next. Controlled: the parent holds every value and owns the save, so create
 * and edit each keep their own single submit. `extraStep` appends a final
 * screen, `footerAside` sits beside the nav on every step, and `finalAction`
 * replaces "next" once the last screen is showing. */
export function ProfileWalkthrough({
  value,
  onChange,
  disabled = false,
  extraStep,
  footerAside,
  finalAction,
}: {
  value: ProfileWalkthroughValue
  onChange: (patch: Partial<ProfileWalkthroughValue>) => void
  disabled?: boolean
  extraStep?: React.ReactNode
  footerAside?: React.ReactNode
  finalAction?: React.ReactNode
}) {
  const [step, setStep] = React.useState(0)
  const stepCount = PROFILE_STEP_COUNT + (extraStep ? 1 : 0)
  const onLastStep = step === stepCount - 1

  return (
    <div className="rounded-xl border border-rule p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          step {step + 1} of {stepCount}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: stepCount }).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full ${
                i <= step ? "bg-foreground" : "bg-rule"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 min-h-[220px]">
        {step === 0 ? (
          <StepShell title="Describe this trip in a few words">
            <textarea
              value={value.idea}
              onChange={(e) => onChange({ idea: e.target.value })}
              placeholder="e.g. 2 weeks surfing in Portugal"
              rows={3}
              disabled={disabled}
              className="w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </StepShell>
        ) : null}

        {step === 1 ? (
          <StepShell title="What's the vibe?" hint="Pick any that apply">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={value.vibe.includes(v)}
                onClick={() => onChange({ vibe: toggled(value.vibe, v) })}
              />
            ))}
            <input
              type="text"
              value={value.vibeNote}
              onChange={(e) => onChange({ vibeNote: e.target.value })}
              placeholder="In your own words…"
              maxLength={500}
              disabled={disabled}
              className="mt-3 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell
            title="What's this trip made of?"
            hint="Your categories — they shape the budget too"
          >
            <LocalCategoryEditor
              categories={value.categories}
              onChange={(categories) => onChange({ categories })}
              disabled={disabled}
            />
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell title="How will you get around?" hint="Pick any that apply">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={value.transport.includes(t)}
                onClick={() =>
                  onChange({ transport: toggled(value.transport, t) })
                }
              />
            ))}
          </StepShell>
        ) : null}

        {step === PROFILE_STEP_COUNT ? extraStep : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || disabled}
          className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          back
        </button>
        <div className="flex items-center gap-2">
          {footerAside}
          {onLastStep && finalAction ? (
            finalAction
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(stepCount - 1, s + 1))}
              disabled={onLastStep || disabled}
              className="rounded-full border-0 bg-foreground px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles on its own**

Run: `pnpm lint`
Expected: clean. The file is not imported yet, so this only proves it type-checks and satisfies the React 19 rules (note `{"// foo"}`-style escaping is not needed here — no bare `//` in JSX text).

---

### Task 2: Rewire the create page

**Files:**
- Modify: `src/app/trips/new/new-trip-form.tsx`

**Interfaces:**
- Consumes: `ProfileWalkthrough`, `ProfileWalkthroughValue` from `../profile-walkthrough` (Task 1).
- Produces: nothing new. `NewTripForm`'s behavior must be identical to before.

**Notes for the implementer:**

The five profile `useState` hooks stay where they are — the component is controlled. What is deleted is the `step` state, the `STEP_COUNT` constant, the `toggle` helper, and the whole stepper block (current lines 245-411). The review recap and the create button move into slots.

- [ ] **Step 1: Swap the imports**

Replace the `profile-fields` import block (current lines 8-13) and add the walkthrough import:

```tsx
import { type LocalCategory } from "../profile-fields"
import { ProfileWalkthrough } from "../profile-walkthrough"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
```

Delete the now-unused `TRIP_TRANSPORT, TRIP_VIBES` import from `@/lib/trips/trip-profile-types` (current line 15) — nothing else in this file references them.

- [ ] **Step 2: Delete the dead state and helper**

Remove these three (current lines 47, 18, and 52-53):

```tsx
const STEP_COUNT = 5
const [step, setStep] = React.useState(0)
const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
  set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
```

- [ ] **Step 3: Replace the stepper block**

Replace everything from `<div className="mt-8 border-t border-rule pt-6">` (current line 245) through its closing `</div>` before `</form>` (current line 411) with:

```tsx
      <div className="mt-8 border-t border-rule pt-6">
        <ProfileWalkthrough
          value={{ idea, vibe, vibeNote, transport, categories }}
          onChange={(patch) => {
            if (patch.idea !== undefined) setIdea(patch.idea)
            if (patch.vibe !== undefined) setVibe(patch.vibe)
            if (patch.vibeNote !== undefined) setVibeNote(patch.vibeNote)
            if (patch.transport !== undefined) setTransport(patch.transport)
            if (patch.categories !== undefined) setCategories(patch.categories)
          }}
          disabled={isPending}
          extraStep={
            <StepShell title="Ready to create">
              <div className="rounded-lg border border-rule px-4 py-3">
                <div className="flex justify-between text-[14px]">
                  <span className="text-muted-foreground">Name</span>
                  <span className="text-foreground">{name.trim() || "—"}</span>
                </div>
                <div className="mt-1 flex justify-between text-[14px]">
                  <span className="text-muted-foreground">When</span>
                  <span className="t-num text-foreground">
                    {isDream
                      ? fuzzyWhen.trim() || "someday"
                      : startDate && endDate
                        ? `${startDate} → ${endDate}`
                        : "—"}
                  </span>
                </div>
                {country.trim() ? (
                  <div className="mt-1 flex justify-between text-[14px]">
                    <span className="text-muted-foreground">Country</span>
                    <span className="text-foreground">{country.trim()}</span>
                  </div>
                ) : null}
                {idea.trim() ? (
                  <p className="mt-2 border-t border-rule pt-2 text-[13px] text-muted-foreground">
                    {idea.trim()}
                  </p>
                ) : null}
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {categories.length} categories · {vibe.length} vibe ·{" "}
                  {transport.length} transport
                </div>
              </div>
              {!basicsReady ? (
                <p className="font-mono text-[10px] text-clay">
                  Add a name{isDream ? "" : " and dates"} above to create.
                </p>
              ) : null}
              {error ? (
                <p className="font-mono text-[10px] text-clay">{error}</p>
              ) : null}
            </StepShell>
          }
          footerAside={
            <button
              type="button"
              onClick={() => router.back()}
              disabled={isPending}
              className="rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              cancel
            </button>
          }
          finalAction={
            <button
              type="button"
              onClick={create}
              disabled={!canSubmit}
              className="rounded-full border-0 bg-foreground px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              {isPending ? "…" : isDream ? "save dream" : "create trip"}
            </button>
          }
        />
      </div>
```

Note the one intentional relocation: the `error` line previously sat between the step body and the footer on every step. It now renders inside the review screen, which is the only step that can produce an error (`create` only runs from there). Add `StepShell` back to the `profile-fields` import for the recap:

```tsx
import { StepShell, type LocalCategory } from "../profile-fields"
```

- [ ] **Step 4: Verify**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. No unused-import or unused-variable warnings — if `TRIP_VIBES`, `toggle`, or `step` still appear, Step 2 was incomplete.

---

### Task 3: Rewire the edit page

**Files:**
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

**Interfaces:**
- Consumes: `ProfileWalkthrough` from `../../profile-walkthrough` (Task 1).
- Produces: nothing new. `EditTripForm`'s props (`tripId`, `dreamDayCount`, `initial`, `initialProfile`, `initialCategories`) are unchanged, so `page.tsx` is not touched.

**Notes for the implementer:**

The five profile `useState` hooks stay, seeded from `initialProfile` / `initialCategories` exactly as now — that is what makes the walkthrough open pre-filled. The `save changes` button in the form footer is untouched and stays enabled on every step, because all five values live here regardless of which step is visible.

- [ ] **Step 1: Swap the imports**

Replace the `profile-fields` import block (current lines 7-11) and the `trip-profile-types` block (current lines 12-16) with:

```tsx
import { type LocalCategory } from "../../profile-fields"
import { ProfileWalkthrough } from "../../profile-walkthrough"
import { type TripProfile } from "@/lib/trips/trip-profile-types"
```

`TRIP_TRANSPORT`, `TRIP_VIBES`, `OptionRow`, and `LocalCategoryEditor` are no longer referenced in this file.

- [ ] **Step 2: Delete the dead helper**

Remove (current lines 94-95):

```tsx
const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
  set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
```

- [ ] **Step 3: Replace the flat profile section**

Replace everything from `<div className="mt-8 border-t border-rule pt-6">` (current line 307) through its closing `</div>` (current line 379) with:

```tsx
        <div className="mt-8 border-t border-rule pt-6">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Profile
          </span>
          <div className="mt-4">
            <ProfileWalkthrough
              value={{ idea, vibe, vibeNote, transport, categories }}
              onChange={(patch) => {
                if (patch.idea !== undefined) setIdea(patch.idea)
                if (patch.vibe !== undefined) setVibe(patch.vibe)
                if (patch.vibeNote !== undefined) setVibeNote(patch.vibeNote)
                if (patch.transport !== undefined) setTransport(patch.transport)
                if (patch.categories !== undefined)
                  setCategories(patch.categories)
              }}
              disabled={isPending}
            />
          </div>
        </div>
```

Nothing else in the file changes. The `error` block and the `cancel` / `save changes` footer that follow it stay exactly where they are.

- [ ] **Step 4: Verify**

Run: `pnpm lint` then `pnpm build`
Expected: both clean, no unused-import warnings.

---

### Task 4: In-app verification and docs

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`

**Notes for the implementer:**

Both doc files already carry unrelated uncommitted edits. Append only; do not reformat or reflow neighboring rows, and do not `git add` them.

- [ ] **Step 1: Run the app and walk the checklist**

Run: `pnpm dev`, then in a browser at a phone viewport:

1. Open `/trips/<slug>/edit` on a trip with a filled profile. Confirm the basics block is unchanged above, and the walkthrough shows `step 1 of 4` with the saved idea text already in the textarea.
2. Press `next` through all four steps. Confirm each is pre-filled from saved data: vibe chips selected, the free-text vibe note present, categories listed with their details, transport chips selected. Confirm `back` works and is disabled on step 1, and `next` is disabled on step 4.
3. Confirm nothing stole focus on load — the page should not be scrolled past the basics.
4. On step 2, change the vibe note. Press `save changes` **from step 2**, without visiting steps 3 or 4.
5. Reopen `/trips/<slug>/edit`. Confirm the vibe-note change persisted **and** categories and transport are unchanged.
6. Open `/trips/new`. Confirm it looks and behaves as before: `step 1 of 5`, `cancel` visible on every step, the review recap on step 5, and the create button only there. Create a trip end to end.

If the Turbopack `0xc0000142` subprocess panic appears on `pnpm dev`, it is a known Windows flake, not a code fault: stop, delete `.next/`, restart.

- [ ] **Step 2: Supersede the 2026-07-22 DECISIONS row**

In `docs/DECISIONS.md`, find the row beginning `**Trip profile edited in \`/edit\` (flat section)...**`. Inside that row's "Why" text, the clause `as a **flat** section (all fields visible — edit is a quick-change surface, unlike create's guided walkthrough)` is now wrong. Append to the end of that same row's Why column:

```
**Superseded 2026-07-28 on the flat-vs-walkthrough point only** — `/edit` now runs the same walkthrough as create (see the 2026-07-28 row). Everything else in this row (Notes as the 4th pill, `updateTrip` growing `profile` + `categories`, category reconciliation by name, the deleted `ProfileTab`/`ProfileOverview`/`ProfileWizard`) still stands.
```

- [ ] **Step 3: Add the new DECISIONS row**

Append a row to the table:

```
| **`/edit` runs the same profile walkthrough as create, via one shared controlled `ProfileWalkthrough`; save works from any step** | The 2026-07-22 choice of a flat `/edit` profile section assumed edit is a quick-change surface that wants every field visible. In use the user wanted the same one-question-per-screen rhythm on both pages. Rather than duplicate the stepper (the `vibeNote` slice had already shown the cost — a new field had to be threaded into both forms by hand), the stepper was extracted to `src/app/trips/profile-walkthrough.tsx`: **controlled**, so it owns only the step index while each page keeps its own state and its own single save (`createTrip` / `updateTrip` untouched). Three optional slots keep create byte-identical in behavior — `extraStep` (the review recap), `footerAside` (cancel, shown on every step), `finalAction` (create trip, replaces "next" on the last step); edit passes none and gets a plain 4-step walkthrough. **Basics stay flat above the walkthrough on both pages** — name/slug/dates are what `/edit` is usually opened for, and burying them behind steps would cost clicks. **Save is enabled on every step in edit** (create still submits only from its review step): all five profile values live in the parent regardless of which step is showing, so saving from step 2 writes vibe *and* categories *and* transport. Step index is local state, not in the URL — it resets to 1 on load. One deliberate delta: `autoFocus` dropped from the step-0 textarea (on create it was already overridden by the name-input focus effect, so create is unaffected; on edit it would have stolen focus and scrolled past the basics). No migration, no deps, no server-action change. Spec: `docs/superpowers/specs/2026-07-28-edit-trip-walkthrough-design.md`; plan: `docs/superpowers/plans/2026-07-28-edit-trip-walkthrough.md`. | 2026-07-28 |
```

- [ ] **Step 4: Add the TODO entry**

Append to `docs/TODO.md` under a new heading:

```markdown
## Edit-trip profile walkthrough — 2026-07-28
- [x] **`/edit` gained the create walkthrough (back/next), via a shared `ProfileWalkthrough`** — Done 2026-07-28. The flat profile section on `/trips/[slug]/edit` is replaced by the same one-question-per-screen stepper create uses (Describe → Vibe → Categories → Getting around), extracted to `src/app/trips/profile-walkthrough.tsx` as a **controlled** component — it owns only the step index; each page keeps its own state and single save, so `createTrip`/`updateTrip` are untouched. Three optional slots keep create unchanged: `extraStep` (review recap), `footerAside` (cancel, every step), `finalAction` (create button, last step only); edit passes none. **Basics stay flat above** on both pages; **save works from any step** in edit (all values live in the parent). `autoFocus` dropped from the step-0 textarea — already overridden on create, harmful on edit. Supersedes the flat-vs-walkthrough half of the 2026-07-22 row. No migration, no deps. Spec + plan: `docs/superpowers/{specs,plans}/2026-07-28-edit-trip-walkthrough*`; DECISIONS row 2026-07-28.
```

---

## Self-Review

**Spec coverage:** shared component → Task 1. Create unchanged → Task 2. Edit rewired, save from any step, step resets on load → Task 3. Basics out of scope → untouched in Tasks 2 and 3. Risk of silent field drop → Task 4 Step 1, items 2 and 5. Follow-up docs → Task 4 Steps 2-4. Covered.

**Placeholder scan:** none — every code step carries the literal code.

**Type consistency:** `ProfileWalkthroughValue` is `{ idea, vibe, vibeNote, transport, categories }` in Task 1 and both call sites pass exactly those five. `onChange` takes `Partial<ProfileWalkthroughValue>` in Task 1 and both call sites narrow with `!== undefined` guards. Slot names `extraStep` / `footerAside` / `finalAction` match across all three tasks.

**Note on the spec:** the spec said cancel "moves into the `finalAction` slot." That was wrong — it would hide cancel on steps 1-4. Corrected here with the third slot, `footerAside`.
