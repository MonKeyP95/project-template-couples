# Planner Input Cleanup (Piece A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The itinerary planner stops reading `vibe` and `activityTypes`, which the new-trip flow no longer collects.

**Architecture:** Delete the two fields from `ItineraryDraftContext`, their prompt lines, the now-unused `list` helper, and the two caller lines. No new inputs; the budget is deliberately not passed.

**Tech Stack:** Next.js 16, TypeScript 5, `@anthropic-ai/sdk` via `runAgent`.

**Spec:** `docs/superpowers/specs/2026-11-05-planner-suggestions-design.md` (section "A. Planner input cleanup")

## Global Constraints

- No tests exist in this repo; verification is `pnpm build`, `pnpm lint`, and grep. Do not add a test runner.
- Do not touch vibe outside the itinerary planner (edit form, profile walkthrough, discover, profile-context keep it).
- No emojis; sparse comments.
- Do not run `pnpm build` while `pnpm dev` is running (shared `.next`).

## Review Focus

- Old trips that still have `vibe` set: the planner simply ignores it; nothing else reads it differently. No test needed — the field stays in `TripProfile`.
- The system prompt's "taste and vibe" wording must not survive, or the model is told about an input it never gets.

---

### Task 1: Remove vibe and activityTypes from the itinerary planner

**Files:**
- Modify: `src/lib/ai/agents/itinerary-planner.ts` (fields at :31 and :35; `list` helper at :47-48; prompt lines at :71 and :74; system prompt at :102)
- Modify: `src/lib/ai/itinerary-actions.ts` (:446 `vibe:` and :449 `activityTypes:` in the `draftItinerary` call)
- Modify: `docs/TODO.md`

**Interfaces:**
- Produces: `ItineraryDraftContext` without `vibe` and `activityTypes`; every other field unchanged.

- [ ] **Step 1: Edit `itinerary-planner.ts`**
  - Delete `vibe: string[]` and `activityTypes: string[]` from `ItineraryDraftContext`.
  - Delete the `list` helper in `itineraryPrompt` and the two array entries that use it (`"Trip vibe"`, `"Activity types they want"`).
  - In `system`, change `"Weight the couple's taste and vibe as a lens, never a checklist. "` to `"Weight the couple's taste as a lens, never a checklist. "`.

- [ ] **Step 2: Edit `itinerary-actions.ts`**
  - Delete the `vibe: trip.tripProfile.vibe,` and `activityTypes: [],` lines from the `draftItinerary({...})` call.

- [ ] **Step 3: Verify nothing references them**

Run: `grep -rn "activityTypes\|vibe" src/lib/ai/agents/itinerary-planner.ts src/lib/ai/itinerary-actions.ts`
Expected: no output.

- [ ] **Step 4: Lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both exit 0 with no new warnings in the two files.

- [ ] **Step 5: Update `docs/TODO.md`**

Add under the current itinerary items: "Planner input cleanup (vibe/activityTypes removed) — implemented; unverified in app. Check: Generate on a new-flow trip still produces an itinerary with no error."

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/agents/itinerary-planner.ts src/lib/ai/itinerary-actions.ts docs/TODO.md docs/superpowers/plans/2026-11-05-planner-input-cleanup.md
git commit -m "refactor(planner): drop vibe and activityTypes inputs"
```

## Success Criteria

**Verified by Claude**
- Step 3 grep returns nothing.
- `pnpm lint` and `pnpm build` clean.

**Verified by the user in-app**
1. Generate on a trip created through the new flow still produces an itinerary with no error.
