# Home Ideas List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every home idea is a `trip_ideas` row; pills are rows `on_pills`; accepting via a created trip marks the row; an "Earlier ideas" list shows the rest with ×.

**Architecture:** Server owns the data (`/home` reads pills + earlier list; actions revalidate `/home`). `IdeasLine` renders from props and keeps only view state. `createTrip` links the idea.

**Tech Stack:** Next.js 16 server actions, Supabase (RLS), `runAgent`.

**Spec:** `docs/superpowers/specs/2026-11-25-home-ideas-list-design.md`

## Global Constraints

- No test suite; verify each task with `pnpm lint` + `pnpm exec tsc --noEmit`; `pnpm build` at the end (dev server must be stopped).
- Migration re-runnable; does not drop `home_ideas.ideas` (live step 1 code).
- Dates en-GB (`25 Nov`). No emojis. `"use client"` files import types from `*-types.ts`.

## Review Focus

- Last pill dismissed or accepted: a new set is made (client after dismiss; mount refresh after accept).
- `ideaId` in the URL that is not a uuid or not this workspace's: `createTrip` must not fail the create (update just matches nothing).
- A trip made from an idea is deleted: `trip_id` goes null, the line looks normal.
- Remade set while a card is open: the card closes (open by id, not found).
- "Already suggested" list capped at 30 labels.

---

### Task 1: Table and queries

**Files:**
- Create: `supabase/migrations/20261125000005_trip_ideas.sql`
- Modify: `src/lib/ai/suggestion-types.ts`, `src/lib/ai/home-idea-queries.ts`

**Interfaces:**
- Produces: `TripIdea` gains `id: string` (`""` before it is saved). `EarlierIdea = TripIdea & { createdAt: string; tripSlug: string | null }`.
- Produces in `home-idea-queries.ts`: `getFingerprint(ws): Promise<string | null>`, `saveFingerprint(ws, fp)`, `listPills(ws): Promise<TripIdea[]>`, `listEarlier(ws): Promise<EarlierIdea[]>` (50 newest not on pills, with trip slug), `recentLabels(ws): Promise<string[]>` (30 newest), `insertIdeas(ws, ideas, onPills): Promise<TripIdea[]>`, `clearPills(ws)`.

- [ ] Step 1: Migration: `trip_ideas` as in the spec, index on `(workspace_id, created_at desc)`, RLS + four policies in a `do $$ ... duplicate_object` block; `home_ideas.ideas` left alone, made nullable-safe already (has default).
- [ ] Step 2: Types and queries; old `getHomeIdeas`/`saveHomeIdeas` removed.
- [ ] Step 3: tsc shows errors only in callers.

### Task 2: Actions and agent prompt

**Files:**
- Modify: `src/lib/ai/home-idea-actions.ts`, `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Produces: `refreshHomeIdeas(fresh: boolean): Promise<{ error?: string }>` (revalidates `/home`), `dismissHomeIdea(id)`, `deleteHomeIdea(id)`.

- [ ] Step 1: Fingerprint = sha256(profileBlock + `buildLearnedFromTrips(ws, past)`).
- [ ] Step 2: Remake when `fresh`, fingerprint differs, or `listPills` is empty: `clearPills`, generate 3 with "Already suggested: <recentLabels>." appended, `insertIdeas(..., true)`, `saveFingerprint`, `revalidatePath("/home")`.
- [ ] Step 3: dismiss = update `on_pills=false`; delete = delete row; both revalidate.
- [ ] Step 4: typed ask in `suggestForSurface` home: insert the one idea with `on_pills=false` and return it with its id.
- [ ] Step 5: lint + tsc clean outside `src/app`.

### Task 3: Accept links the trip

**Files:**
- Modify: `src/app/trips/new/page.tsx`, `src/app/trips/new/new-trip-form.tsx`, `src/lib/trips/actions.ts`

- [ ] Step 1: Page reads `ideaId` from search params, passes `initialIdeaId: string | null`; form passes `ideaId` to `createTrip`.
- [ ] Step 2: `CreateTripInput.ideaId?: string | null`; after the itinerary build, when set and a uuid: update `trip_ideas` set `trip_id`, `on_pills=false` where `id` and `workspace_id`; errors ignored (the trip exists).
- [ ] Step 3: lint + tsc.

### Task 4: Home UI

**Files:**
- Modify: `src/app/home/page.tsx`, `src/app/home/ideas-line.tsx`
- Create: `src/app/home/earlier-ideas.tsx`

- [ ] Step 1: Page passes `pills` and `earlier` from the queries.
- [ ] Step 2: `IdeasLine`: pills from props; open by id; dismiss calls `dismissHomeIdea` then, when it was the last pill, `refreshHomeIdeas(false)`; accept adds `ideaId`; "Earlier ideas · N ›" toggles the list (shown when N > 0).
- [ ] Step 3: `EarlierIdeas({ ideas, onAccept })`: lines newest first (label, `25 Nov`, clamped first line, ×); tap expands body + "let's do it"; a trip idea is faded with "became a trip ›" link, no button; × calls `deleteHomeIdea`.
- [ ] Step 4: lint, tsc, `pnpm build`; TODO entry with in-app checks; commit.
