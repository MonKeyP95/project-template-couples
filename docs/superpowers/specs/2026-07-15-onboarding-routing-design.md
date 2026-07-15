# Onboarding routing: new trip → profile → guided itinerary

**Date:** 2026-07-15
**Slice:** "Plan your itinerary" — Slice 3 (onboarding routing)
**Status:** design approved, plan pending

## Problem

The three onboarding surfaces already exist but aren't connected:

- The new-trip form already routes to `?tab=profile` on create.
- The Profile tab lands on a read-only overview → "set up profile" opens the 4-step
  `ProfileWizard` (idea → categories → transport → vibe) → on save, `onDone()` returns
  to the overview.
- The Itinerary tab has the guided `PlanItinerary` stepper, opened by pressing it.

The missing piece is the **baton-pass**: after a brand-new trip's profile is saved,
nothing hands the couple off to the itinerary planner. They drop back onto the
read-only profile overview. This slice threads one continuous path through the
surfaces that already exist.

## Decision

An **explicit guided baton-pass**, moved by buttons — not a silent tab-jump, not a
passive nudge. One continuous path; every step stays skippable and back-outable.
Onboarding flags only *bias* initial state; they never gate navigation.

## Flow

1. **New trip (dated) → profile.** The new-trip form routes to
   `?tab=profile&onboarding=1` (adds the flag to today's `?tab=profile`). Dreams stay
   at `?tab=profile` with no flag — scoped out, the guided planner is dated-trips-only.

2. **Profile opens straight in the wizard.** In onboarding, `ProfileTab` initializes
   `editing=true`, skipping the read-only overview (the profile is blank anyway).
   Normal later edits are unchanged (still land on the overview first).

3. **Wizard's final button becomes the baton.** On the last step, "save profile" reads
   **"save & plan itinerary →"** in onboarding. On save success it routes to
   `?tab=itinerary&plan=1` instead of calling `onDone()`. Step-0 "cancel" still bails
   to the overview.

4. **Itinerary tab auto-opens the guided planner.** `PlanItinerary` reads `plan=1`
   (via `useSearchParams`) and opens its stepper on arrival. From there it is the
   existing Setup → 5 categories → Apply flow, unchanged.

## Components and changes

Additive glue. No migration, no deps, no AI change, no new component. Five files:

- **`new-trip-form.tsx`** — on a dated create, push `?tab=profile&onboarding=1`
  (dreams keep `?tab=profile`).
- **`page.tsx`** — read `onboarding` from `searchParams`; pass it to `ProfileTab`.
  Read `plan` is *not* needed here (client `PlanItinerary` reads it directly).
- **`profile-tab.tsx`** — accept an `onboarding` prop; when set, initialize
  `editing=true` and pass `onboarding` through to `ProfileWizard`.
- **`profile-wizard.tsx`** — accept an `onboarding` prop; when set, the final button
  reads "save & plan itinerary →" and `save()` routes to `?tab=itinerary&plan=1` on
  success instead of `onDone()`. All other behavior identical.
- **`plan-itinerary.tsx`** — read `plan` via `useSearchParams`; default `open` to
  `true` when `plan=1`. Otherwise unchanged (press-to-open still works).

## Properties / invariants

- **Never a gate.** The `onboarding`/`plan` flags only bias initial state. Tabs, back,
  and cancel all work normally. A couple can ignore the whole path and the app behaves
  exactly as today.
- **Explicit flag, not inferred emptiness.** Detection is the query flag, so it can't
  misfire on a returning couple who happens to have an empty itinerary.
- **Scope: dated trips only.** Dreams keep today's behavior (no dated planner to hand
  off to). The guided `PlanItinerary` is already dated-trips-only.
- **No new persistence.** The flags are transient URL state; nothing is stored. Re-visiting
  the trip URL without the flags is the normal (non-onboarding) experience.

## Out of scope

- Dreams onboarding (no dated planner target).
- Any change to the profile wizard's steps or the itinerary stepper's content.
- Persisting "has onboarded" — not needed; the flag is one-shot URL state.
- A cross-tab progress indicator / checklist.

## Open questions

None. Design approved 2026-07-15.
