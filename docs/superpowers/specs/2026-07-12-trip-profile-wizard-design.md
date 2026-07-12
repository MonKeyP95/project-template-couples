# Trip Profile Wizard — Design

**Date:** 2026-07-12
**Status:** Approved, ready for implementation plan

## Problem

The trip Profile tab presents its inputs as a flat wall of pills — a Vibe
multi-select and a Who's-coming single-select — with no guidance, and the trip's
**categories** (the real building blocks that also drive the Budget) sit in a
separate block below, disconnected from the profile. It reads as "pill soup"
with the most meaningful concept relegated to a footnote.

The user wants the profile filled through a **guided wizard** grounded in the
categories: start from a free-text idea, then shape the trip's category set (the
backbone), then answer the couple of questions a category can't express. Big
tappable **option rows**, not small pills.

## Core idea: categories are the backbone

Every trip is seeded with a default category set (Surf, Dive, Trek, Food,
Transit, Lodging, Other, Activities) as real `expense_categories` rows. They
already do double duty: they define what the trip is made of *and* drive the
Budget. This redesign makes shaping that set the **centerpiece of the profile**
— keep, drop, add — instead of a block tucked underneath. Adding "Kitesurf" is a
meaningful act that enriches the trip's identity and its budget at once.

A wizard step earns its place only if it captures something the category set
can't:
- **Activities** (Surf/Dive/Trek/Food/…) → categories express this. *Merged.*
- **Getting around** → the "Transit" category says money moves on transport, not
  whether you have a car, rent one, or take buses. That detail changes what the
  assistant suggests. *Kept as its own question.*
- **Vibe** → not a spending category; feeds AI discovery. *Kept.*
- **Accommodation status** → really a planning to-do, and "Lodging" already
  covers the money side. *Dropped* as a profile field.

## Scope

Redesign the trip Profile tab's top section as the wizard, folding the existing
Categories editor into it as the backbone step. The **Notes** section stays
below, unchanged. No AI is wired in this slice (fixed steps, structured so the
questions could go AI-driven in Phase 5 later).

## The wizard

Four steps, one question per screen, with a `1 of 4` progress indicator and
Back/Next. The final step's primary button is **Save profile**.

1. **The idea** — a roomy free-text textarea. Prompt: "Sum up this trip in a
   line." Replaces both the old headline and the old About box.
2. **Categories (the backbone)** — the trip's `expense_categories`, shown as
   rows: each removable, plus an add-your-own affordance. This is the existing
   category editor, restyled and promoted. **Live server writes** (add inserts a
   row, remove deletes it and moves its expenses to "Other" — unchanged
   behavior). This is the same list edited in Budget.
3. **Getting around** — multi-select. Options: Own car, Rental car, Public
   transport, Flights between stops, Taxis & walking.
4. **Vibe** — multi-select. The existing `TRIP_VIBES` set, unchanged.

**Interaction details**
- Steps 3 and 4 use **large option rows** (label + selected state), not small
  pills. Step 2 uses category rows with a remove control + an add row.
- Steps 1, 3, 4 (the jsonb fields) are held in local state and saved **once** on
  the final step. Step 2 (categories) writes immediately, as today — so the
  wizard is intentionally two-speed: categories persist live; idea/transport/
  vibe persist on Save.
- Leaving mid-wizard discards unsaved jsonb edits but keeps any category changes
  already written (acceptable).
- Reopening the Profile tab **re-runs the wizard from step 1**, pre-filled with
  the last saved answers and the current category set. No separate read-only
  summary view.

## Data model

`src/lib/trips/trip-profile-types.ts`:

```ts
export const TRIP_TRANSPORT = [
  "Own car",
  "Rental car",
  "Public transport",
  "Flights between stops",
  "Taxis & walking",
] as const

export const TRIP_VIBES = [/* unchanged */] as const

export interface TripProfile {
  idea: string        // free-text; replaces headline + brief
  transport: string[] // new, multi-select
  vibe: string[]      // unchanged
}
```

`TRIP_WHO` and the `who` / `brief` / `headline` fields are removed. Categories
are **not** stored in `trip_profile` — they remain their own
`expense_categories` rows. There is no `accommodation` field.

**Back-compat parse.** `parseTripProfile` reads `idea`; if absent, it falls back
to the legacy `headline` then `brief` so existing trips keep their text. It
tolerantly filters `transport` against `TRIP_TRANSPORT` and `vibe` against
`TRIP_VIBES`. Never throws on legacy/malformed jsonb. The `trip_profile` jsonb
column needs no migration.

## Consumers to update

Found via grep; all must move off the dropped fields:

- `src/app/trips/[slug]/page.tsx:410-413` — trip header shows
  `tripProfile.headline`. Switch to `tripProfile.idea`, truncated to one line.
- `src/lib/ai/budget-actions.ts:91` — reads `trip.tripProfile.brief`. Remap to
  `trip.tripProfile.idea` (the AI query keeps its `brief` key, now sourced from
  the idea text). No prompt-builder change needed.
- `src/app/api/ai/discover/route.ts:65` — passes `{ vibe, brief }`. Remap
  `brief: profile.brief` → `brief: profile.idea`.
- `src/lib/ai/claude.ts` — no change; its prompt builders read the AI query's
  `brief` key, which the two mapping sites above now feed from `idea`.
- `src/lib/trips/actions.ts:1440-1445` — `saveTripProfile` validation. Replace
  headline/who/brief handling with: `idea` (trimmed, capped ~2000), `transport`
  (filtered against `TRIP_TRANSPORT`), `vibe` (unchanged). Swap the `TRIP_WHO`
  import for `TRIP_TRANSPORT`.
- `src/app/trips/[slug]/profile-tab.tsx` — rewrite as the wizard host. Notes
  stays below; the standalone Categories block is absorbed into wizard step 2.

**Deferred (not this slice):** wiring `transport` into the AI prompts. It touches
the AI query types and prompt builders for marginal gain (discovery already
carries a per-request `walkable` flag). The field is captured and stored now,
available to AI later.

## Component structure

- `profile-wizard.tsx` (new, client) — owns step state (`step`, and local copies
  of `idea`, `transport`, `vibe`) and the save call. Receives `tripId`,
  `tripSlug`, `profile`, and the current `categories` list.
  - `StepShell` — progress `n of 4`, title, Back/Next or Save.
  - `OptionRow` — label + selected state, single- vs multi-select via props (used
    by Getting around and Vibe).
  - `CategoryStep` — the backbone step: category rows with remove + an add row,
    calling the existing `addExpenseCategory` / `deleteExpenseCategory` actions
    live (the current `TripCategories` logic, restyled).
- `profile-tab.tsx` — renders `<ProfileWizard/>` then `<NotesTab/>`. The
  standalone Categories block is gone (absorbed into the wizard).

Keep files focused; import shared types from `trip-profile-types.ts` per the
client-component types-split rule.

## Non-goals / YAGNI

- No AI-generated questions (Phase 5).
- No read-only summary card, no per-line jump-to-edit.
- No accommodation field; no Who's-coming.
- No migration of the jsonb column; no schema change to `expense_categories`.
- No changes to Notes or to how categories drive Budget.

## Success criteria

- Profile tab opens on the wizard, step 1, pre-filled from saved data and the
  current category set.
- Four steps navigate with Back/Next; category add/remove writes live; Getting
  around + Vibe multi-select behave correctly.
- Save persists idea + transport + vibe; reopening shows them pre-filled.
- Existing trips (legacy `headline`/`brief`) still show their text in the idea
  step and the trip header.
- AI budget/discover/chat context still populates (idea + vibe), no runtime
  errors from the dropped fields.
- Notes renders unchanged below the wizard.
- `pnpm lint` and `pnpm build` pass.
