# Trip Journal — Slice 3 Implementation Plan (declutter the closed-trip journal)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/profile` "By trip", stop rendering the redundant raw journal for a **closed** trip that already has an AI taste summary — the taste blocks + money block stand in for it. Ongoing trips and low-signal closed trips keep their journal, so no trip row is ever blank.

**Architecture:** One surgical change in `profile/page.tsx`: gate the existing `{journal ? <TripJournal .../> : null}` render (line ~313) so the journal renders only when the trip is **not** closed **or** has **no** taste blocks. Equivalently: hide the journal only when the trip is closed AND has taste blocks. Everything else — `getTripJournal`/`assembleJournal`, the `byTripRows` inclusion filter, the general top-level sections, `BudgetHistory` — is untouched. Nothing is deleted: the journal is derived, not stored, so this only hides a rendered view.

**Tech Stack:** Next.js 16 App Router (React 19 Server + Client Components), TypeScript, Supabase, Tailwind v4. Package manager: `pnpm`.

## Global Constraints

- Verification is `pnpm lint` and `pnpm build` (repo has no test framework — do not invent one).
- No schema change, no migration, no new dependency, no AI/prompt change.
- Do NOT touch `getTripJournal`, `assembleJournal`, or `journal-queries.ts` — the journal is still fetched for all started trips.
- Do NOT change the `byTripRows` inclusion filter (`tasteByTrip.has || budgetByTrip.has || journalByTrip.has`) — no row may disappear.
- Do NOT touch the general top-level "What we like" sections, `LearnedSummary`, `BudgetHistory`, or `TripBudget`.
- This slice is part (a) only. Re-sourcing the AI summary from the journal (b) and rewiring the general profile/budget history to "past summaries + current raw" (c) are explicitly deferred.
- No emojis in code.
- Spec: `docs/superpowers/specs/2026-07-20-trip-journal-slice-3-design.md`.

---

### Task 1: Gate the closed-trip journal render

Hide the raw `TripJournal` only for closed trips that have taste blocks. `pastTripIds` (`page.tsx:76`), and the per-row `blocks` and `journal`, are already in scope.

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `pastTripIds: Set<string>` (already computed at `page.tsx:76`); the destructured row fields `trip`, `blocks` (taste blocks, `[]` when none), `journal` (`JournalRecord | null`).
- Produces: no new exports; render-condition change only.

- [ ] **Step 1: Read the current journal render**

In `src/app/profile/page.tsx`, inside the `byTripRows.map(({ trip, blocks, budget, journal }) => ...)` loop, the journal renders unconditionally when present (around line 313):

```tsx
                    {journal ? (
                      <TripJournal record={journal} memberNames={memberNames} />
                    ) : null}
```

- [ ] **Step 2: Add the closed-AND-has-blocks gate**

Replace that block with a condition that hides the journal only when the trip is closed **and** has taste blocks:

```tsx
                    {journal && !(pastTripIds.has(trip.id) && blocks.length > 0) ? (
                      <TripJournal record={journal} memberNames={memberNames} />
                    ) : null}
```

Read equivalently: show the journal when there is a journal AND (the trip is ongoing OR it has no taste blocks). No other line changes — `blocks.map(...)` above and `{budget ? <TripBudget .../> : null}` below stay exactly as they are.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Reason through behavior (no test framework)**

Confirm by reading the render loop against the spec's row-outcomes table:
- Ongoing (`now`) trip: `pastTripIds.has(trip.id)` is false -> gate passes -> journal still renders (unchanged).
- Closed (`past`) trip with taste blocks (`blocks.length > 0`): closed AND has blocks -> journal hidden; taste blocks + money block still render.
- Closed (`past`) trip below the signal floor (`blocks.length === 0`): `blocks.length > 0` is false -> gate passes -> journal still renders (row not blank; money block still renders if it has spend).
- `byTripRows` inclusion filter unchanged -> no row disappears; a closed trip with a summary still appears via `tasteByTrip`/`budgetByTrip`.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(journal): hide raw journal for closed trips that have a taste summary"
```

---

### Task 2: Docs — TODO + DECISIONS

Record the slice as shipped and the one non-obvious choice.

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Add a TODO entry**

Prepend a Slice-3 entry under the "Current Phase" block in `docs/TODO.md` summarizing: on `/profile` "By trip", the raw journal is now hidden for a closed trip that has a taste summary (the summary stands in for it); ongoing trips and low-signal closed trips keep their journal; nothing deleted (journal is derived); `getTripJournal`, the inclusion filter, general sections, and `BudgetHistory` untouched; no schema/migration/AI change. Note in-app verification pending, and that deferred parts (b) re-source AI from the journal and (c) rewire the general profile/budget history to past-summaries + current-raw remain held until matching or scale pushes on them. Reference the spec and this plan.

- [ ] **Step 2: Add a DECISIONS row**

Append a `2026-07-20` row to `docs/DECISIONS.md`: "Closed-trip raw journal on `/profile` is hidden once the trip has AI taste blocks (summary replaces the redundant raw view); kept for ongoing and below-signal-floor closed trips so no row is blank. Journal is derived, not stored — nothing deleted, one condition away from rendering again. Re-sourcing the AI summary from the journal and rewiring the general profile to past-summaries deferred (premature at current scale)." Match the existing row format in that file.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs(journal): record Slice 3 shipped (TODO + DECISIONS)"
```

---

## Self-Review

**Spec coverage:**
- "The single rule" (render journal when not closed OR no taste blocks; hide only when closed AND has blocks) — Task 1 Step 2 implements it verbatim. Covered.
- "What changes" (only `page.tsx` ~line 313; inclusion filter unchanged) — Task 1 edits only that render line. Covered.
- "What does NOT change" (`getTripJournal`/`assembleJournal`/`journal-queries.ts`, general sections, `BudgetHistory`/`TripBudget`/`LearnedSummary`, no schema/migration/deps/AI) — Global Constraints forbid all of it; no task touches them. Covered.
- "Row outcomes after this slice" table (ongoing = journal only; closed+blocks = taste + money, journal hidden; closed below floor = journal kept) — Task 1 Step 5 reasoning walks all three. Covered.
- Scope decision (this slice is (a) only; (b) and (c) deferred) — Global Constraints + Task 2 docs record the deferral. Covered.
- Success criteria (closed+blocks hides journal; closed below floor keeps it; ongoing keeps it; inclusion unchanged; general + `BudgetHistory` unchanged; no schema; `getTripJournal`/AI untouched; lint+build) — Task 1 verification + Global Constraints. Covered.

**Placeholder scan:** No TBD/TODO-in-code; the one code step shows exact before/after. Docs task (Task 2) describes prose content to write, matching how prior slices logged docs. Clean.

**Type consistency:** `pastTripIds` is `Set<string>`; `trip.id` is a string; `blocks` is an array (`.length` valid); `journal` is `JournalRecord | null` (truthiness valid). Condition is boolean. Consistent.
