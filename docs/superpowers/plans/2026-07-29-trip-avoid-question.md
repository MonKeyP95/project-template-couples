# "Anything to avoid?" Trip Question — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one negative question — "anything to avoid this trip?" — as a persisted trip-profile field, asked at the end of the create/edit walkthrough and again inside the itinerary planner, and fed to the assistant as a hard constraint.

**Architecture:** One new string field `avoid` on the jsonb `trip_profile` (no migration). The create/edit walkthrough gains a fifth textarea step. The itinerary planner gains a `kind: "text"` step that renders a textarea instead of an add-list, prefilled from the profile and written back through the existing `saveTripProfile` action when the walk ends. The value reaches every AI surface through `buildProfileBlock`, plus a dedicated constraint line in the itinerary prompt.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (jsonb column), Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-trip-avoid-question-design.md`.
- **No test suite exists in this repo.** Verification is `pnpm lint`, `pnpm build`, and reasoning through the data path. Do not invent a test command.
- **Do not run `pnpm build` while `pnpm dev` is running** — they share `.next/` and the build clobbers it.
- No emojis in code, comments, or logs. Sparse comments; explain WHY only when non-obvious.
- `avoid` is capped at 500 chars on write, matching `vibeNote`.
- Never claim in-app behavior is verified; report "implemented; build and lint clean; unverified in app".
- Commit after each task.

---

### Task 1: The `avoid` field on the trip profile

**Files:**
- Modify: `src/lib/trips/trip-profile-types.ts`
- Modify: `src/lib/trips/actions.ts` (three sanitize sites: ~:731, ~:881, ~:1680)

**Interfaces:**
- Consumes: nothing.
- Produces: `TripProfile.avoid: string`; `EMPTY_TRIP_PROFILE.avoid === ""`; `parseTripProfile` returns `avoid` for every trip.

- [ ] **Step 1: Add `avoid` to the type and the empty value**

In `src/lib/trips/trip-profile-types.ts`, add the field to the interface after `vibeNote`:

```ts
export interface TripProfile {
  idea: string
  transport: string[]
  vibe: string[]
  vibeNote: string
  /** Free text: what they would rather not do. A hard constraint for the assistant. */
  avoid: string
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  idea: "",
  transport: [],
  vibe: [],
  vibeNote: "",
  avoid: "",
}
```

- [ ] **Step 2: Parse it tolerantly**

In the same file, add to the object `parseTripProfile` returns, after `vibeNote`:

```ts
    avoid: typeof r.avoid === "string" ? r.avoid : "",
```

Legacy trips have no `avoid` key, so they read as `""` — no backfill.

- [ ] **Step 3: Sanitize it at all three write sites**

In `src/lib/trips/actions.ts`, add this line directly after each of the three existing `vibeNote: ... .slice(0, 500),` lines — in `createTrip`, in `updateTrip`, and in `saveTripProfile`:

```ts
    avoid: p.avoid.trim().slice(0, 500),
```

In `updateTrip` the surrounding object uses `input.profile` rather than `p`, so that one reads:

```ts
            avoid: input.profile.avoid.trim().slice(0, 500),
```

- [ ] **Step 4: Verify**

Run: `pnpm lint`
Expected: clean. Type errors here would surface as `avoid` missing from object literals that build a `TripProfile` — fix any by adding the field. Do not add `avoid` to call sites that pass a partial profile through `EMPTY_TRIP_PROFILE`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/trip-profile-types.ts src/lib/trips/actions.ts
git commit -m "feat(profile): avoid field on the trip profile"
```

---

### Task 2: The fifth walkthrough step

**Files:**
- Modify: `src/app/trips/profile-walkthrough.tsx`
- Modify: `src/app/trips/new/new-trip-form.tsx`
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

**Interfaces:**
- Consumes: `TripProfile.avoid` from Task 1.
- Produces: `ProfileWalkthroughValue.avoid: string`; `PROFILE_STEP_COUNT === 5`.

- [ ] **Step 1: Raise the step count and extend the value type**

In `src/app/trips/profile-walkthrough.tsx`:

```ts
const PROFILE_STEP_COUNT = 5
```

```ts
export interface ProfileWalkthroughValue {
  idea: string
  vibe: string[]
  vibeNote: string
  transport: string[]
  categories: LocalCategory[]
  avoid: string
}
```

- [ ] **Step 2: Add the step body**

In the same file, insert between the `step === 3` block and the `step === PROFILE_STEP_COUNT ? extraStep : null` line:

```tsx
        {step === 4 ? (
          <StepShell title="Anything to avoid?" hint="Optional">
            <textarea
              value={value.avoid}
              onChange={(e) => onChange({ avoid: e.target.value })}
              placeholder="e.g. no long drives, we'd rather skip the big tourist spots"
              rows={3}
              maxLength={500}
              disabled={disabled}
              className="w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </StepShell>
        ) : null}
```

The `extraStep` line below it needs no change: it already keys off `PROFILE_STEP_COUNT`, which is now 5, so the create page's summary moves to step 6 automatically.

- [ ] **Step 3: Wire the create form**

In `src/app/trips/new/new-trip-form.tsx`, add state after `vibeNote`:

```ts
  const [avoid, setAvoid] = React.useState("")
```

Add it to the `createTrip` payload:

```ts
        profile: { idea, transport, vibe, vibeNote, avoid },
```

Add it to the walkthrough value and patch handler:

```tsx
          value={{ idea, vibe, vibeNote, transport, categories, avoid }}
```

```ts
            if (patch.avoid !== undefined) setAvoid(patch.avoid)
```

- [ ] **Step 4: Wire the edit form**

In `src/app/trips/[slug]/edit/edit-trip-form.tsx`, the same four edits, seeded from the loaded profile:

```ts
  const [avoid, setAvoid] = React.useState(initialProfile.avoid)
```

```ts
        profile: { idea, transport, vibe, vibeNote, avoid },
```

```tsx
              value={{ idea, vibe, vibeNote, transport, categories, avoid }}
```

```ts
                if (patch.avoid !== undefined) setAvoid(patch.avoid)
```

- [ ] **Step 5: Verify**

Run: `pnpm lint`
Expected: clean.

Reason through the write path (do not skip — a dropped field here is the classic "doesn't save" bug): the textarea calls `onChange({ avoid })` -> the form's patch branch sets state -> state goes into `profile` -> `createTrip`/`updateTrip` sanitize `avoid` (Task 1) -> it lands in the `trip_profile` jsonb.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/profile-walkthrough.tsx src/app/trips/new/new-trip-form.tsx "src/app/trips/[slug]/edit/edit-trip-form.tsx"
git commit -m "feat(profile): ask what to avoid as the last walkthrough step"
```

---

### Task 3: The planner's text step

**Files:**
- Modify: `src/lib/ai/itinerary-planner.ts` (`ItineraryPlanStep`, `planItinerarySteps`)
- Modify: `src/app/trips/[slug]/plan-itinerary.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (prop pass-through)
- Modify: `src/app/trips/[slug]/page.tsx` (prop source)

**Interfaces:**
- Consumes: `TripProfile.avoid` from Task 1.
- Produces: `ItineraryPlanStep.kind: "entries" | "text"`; the step keyed `"avoid:trip"`; `PlanItineraryProps.avoid: string`. Task 4 consumes the `avoid` string these hand to the server actions.

- [ ] **Step 1: Type the step kind**

In `src/lib/ai/itinerary-planner.ts`, add to `ItineraryPlanStep`:

```ts
  /** "entries" steps collect add-list rows that become itinerary events.
   * "text" steps collect one free-text answer that never becomes an event. */
  kind: "entries" | "text"
```

- [ ] **Step 2: Mark the existing steps and add the avoid step**

In `planItinerarySteps`, add `kind: "entries",` as the first property of all five existing `steps.push({...})` objects (the three per-place ones plus `transportation:trip` and `other:trip`).

Then insert this new push between the `transportation:trip` push and the `other:trip` push:

```ts
  steps.push({
    key: "avoid:trip",
    kind: "text",
    category: "Avoid",
    title: "Anything to avoid?",
    question: "Anything to avoid this trip?",
    hint: "Optional - what you'd rather skip. Saved to the trip.",
    addNoun: "",
    place: null,
  })
```

- [ ] **Step 3: Hold the avoid text in the planner**

In `src/app/trips/[slug]/plan-itinerary.tsx`, add the prop:

```ts
export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
  /** The trip's saved avoid text; the walk prefills from it and writes it back. */
  avoid: string
}
```

Destructure it as `avoid: initialAvoid` in the component signature, and add state next to `freeText`:

```ts
  const [avoid, setAvoid] = React.useState(initialAvoid)
```

In `reset()`, restore it rather than blanking it:

```ts
    setAvoid(initialAvoid)
```

- [ ] **Step 4: Keep text steps out of the entry rows**

In `startWalk`, seed rows for entry steps only, so `items["avoid:trip"]` never exists and `collectEntries` cannot pick it up:

```ts
      for (const s of nextSteps) {
        if (s.kind !== "entries") continue
        next[s.key] = prev[s.key] ?? [newRow()]
      }
```

- [ ] **Step 5: Render the textarea for text steps**

In `renderStep`, immediately after `const rows = items[step.key] ?? []`, return the text variant before the add-list markup:

```tsx
    if (step.kind === "text") {
      return (
        <>
          <div className="flex items-center justify-between">
            <Label>Plan your itinerary</Label>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              step {stepIndex + 1} of {steps.length}
            </span>
          </div>

          <div className="mt-2 font-serif text-[15px] italic text-foreground">
            {step.title}
          </div>
          <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
            {step.hint}
          </div>

          <textarea
            value={avoid}
            placeholder="e.g. no long drives, skip the big tourist spots"
            rows={3}
            maxLength={500}
            onChange={(e) => setAvoid(e.target.value)}
            className="mt-3 w-full resize-y border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={walkBack}
              className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              back
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={walkNext}
                className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                {isLast ? "review" : "next"}
              </button>
            </div>
          </div>
        </>
      )
    }
```

`rows` stays unused in this branch — it is declared above and only read by the add-list markup that follows.

- [ ] **Step 6: Pass it to both terminal actions**

In `apply()` and in `generate()`, add `avoid: avoid.trim(),` to the object passed to `applyPlanEntries` and `draftAndApplyItinerary` respectively. (Task 4 adds the parameter on the server side; lint will flag it until then — that is expected and resolves in Task 4.)

- [ ] **Step 7: Thread the prop in**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add `avoid,` to the destructured props and `avoid: string` to the prop type, then pass it down:

```tsx
            <PlanItinerary tripId={tripId} tripSlug={tripSlug} destination={destination} avoid={avoid} />
```

In `src/app/trips/[slug]/page.tsx`, on the `<ItineraryTab ...>` element, add:

```tsx
              avoid={header.tripProfile.avoid}
```

`header` comes from `getTripBySlug`, which already returns a parsed `tripProfile`.

- [ ] **Step 8: Verify**

Run: `pnpm lint`
Expected: clean once Task 4 lands; until then only the two `avoid:` arguments in Step 6 may error as unknown properties. If any other error appears, fix it now.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ai/itinerary-planner.ts "src/app/trips/[slug]/plan-itinerary.tsx" "src/app/trips/[slug]/itinerary-tab.tsx" "src/app/trips/[slug]/page.tsx"
git commit -m "feat(planner): avoid step in the guided itinerary walk"
```

---

### Task 4: Write-back and the prompt

**Files:**
- Modify: `src/lib/ai/itinerary-actions.ts` (`applyPlanEntries`, `draftAndApplyItinerary`)
- Modify: `src/lib/ai/profile-context.ts`
- Modify: `src/lib/ai/agents/itinerary-planner.ts`

**Interfaces:**
- Consumes: the `avoid` argument sent by Task 3; `saveTripProfile` from `@/lib/trips/actions`.
- Produces: `ItineraryDraftContext.avoid: string`.

- [ ] **Step 1: A shared write-back helper**

In `src/lib/ai/itinerary-actions.ts`, import the existing action rather than reaching for Supabase directly:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  saveTripProfile,
} from "@/lib/trips/actions"
```

Then add near `inclusiveDays`:

```ts
/** Persist an avoid answer edited mid-walk. The planner box is the trip
 * profile's field, not a copy, so both terminal actions write it back. */
async function persistAvoid(
  trip: { id: string; tripProfile: TripProfile },
  tripSlug: string,
  avoid: string | undefined,
): Promise<void> {
  if (avoid === undefined) return
  const next = avoid.trim().slice(0, 500)
  if (next === trip.tripProfile.avoid) return
  await saveTripProfile({
    tripId: trip.id,
    tripSlug,
    profile: { ...trip.tripProfile, avoid: next },
  })
}
```

Add the type import:

```ts
import type { TripProfile } from "@/lib/trips/trip-profile-types"
```

- [ ] **Step 2: Call it from both terminal actions**

In `applyPlanEntries`, add `avoid?: string` to the input type and call the helper right after the `if (!trip || !trip.startDate)` guard:

```ts
  await persistAvoid(trip, input.tripSlug, input.avoid)
```

Do the same in `draftAndApplyItinerary` — same input field, same call site after its own guard.

- [ ] **Step 3: Feed the drafter the constraint**

In `src/lib/ai/agents/itinerary-planner.ts`, add to `ItineraryDraftContext` after `freeText`:

```ts
  /** What they do not want. A constraint, not a preference. */
  avoid: string
```

In `itineraryPrompt`, add this entry to the array immediately after the `c.freeText` line — before the `profileBlock` line, so the constraint is stated plainly rather than inside the "a lens, not a checklist" framing:

```ts
    c.avoid ? `Must avoid - do not include any of these: ${c.avoid}.` : "",
```

In `draftAndApplyItinerary`, pass the post-write-back value in the `draftItinerary({...})` call, after `freeText`:

```ts
      avoid: input.avoid?.trim() ?? trip.tripProfile.avoid,
```

- [ ] **Step 4: Feed every other surface**

In `src/lib/ai/profile-context.ts`, add after the `transport` line inside the `if (tripId)` block:

```ts
    if (profile.avoid.trim())
      parts.push(`Avoid, treat as a hard constraint: ${profile.avoid.trim()}.`)
```

Empty stays omitted, like every other part.

- [ ] **Step 5: Verify**

Run: `pnpm lint`
Expected: clean, including the Task 3 call sites that were pending.

Run: `pnpm build` (only if `pnpm dev` is not running)
Expected: success.

Reason through the write path: planner textarea -> `avoid` state -> `apply()`/`generate()` -> action input -> `persistAvoid` compares against the stored value and calls `saveTripProfile`, which sanitizes and writes `trip_profile`. On the next page load `getTripBySlug` parses it back and `page.tsx` prefills the planner and the edit form.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/itinerary-actions.ts src/lib/ai/profile-context.ts src/lib/ai/agents/itinerary-planner.ts
git commit -m "feat(ai): treat the trip's avoid text as a hard constraint"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record the work**

Add a TODO entry marked *implemented, unverified in-app*, carrying the in-app checklist from the spec's second success-criteria list.

- [ ] **Step 2: Record the decision**

Append a DECISIONS row: the planner's avoid box is the trip profile's field rather than a per-draft override — one stored value, written back by both Generate and apply, so the two cannot drift.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the avoid question"
```

---

## Self-Review

**Spec coverage:** section 1 -> Task 1; section 2 -> Task 2; section 3 -> Task 3; section 4 -> Task 4; "deliberately not doing" needs no task. All seven Claude-verified criteria are reachable from Tasks 1-4.

**Type consistency:** `avoid` is the property name everywhere — `TripProfile`, `ProfileWalkthroughValue`, `PlanItineraryProps`, `ItineraryDraftContext`, and both action inputs. `kind` is `"entries" | "text"` in both its definition and its two consumers. `persistAvoid` takes `(trip, tripSlug, avoid)` at both call sites.

**Known cross-task dependency:** Task 3 Step 6 sends an argument the server accepts only after Task 4 Step 2. Tasks 3 and 4 must land in order; the intermediate commit does not typecheck standalone.
