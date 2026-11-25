# Three Home Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One saved AI call makes three full home ideas shown as pills; tapping a pill opens its idea with no call.

**Architecture:** The `trip-idea` agent's tool returns a list of ideas (count set by the caller). `home_ideas.ideas` (jsonb) holds the saved set; `IdeasLine` keeps the set plus an open index.

**Tech Stack:** Next.js 16 server actions, Supabase, `@anthropic-ai/sdk` via `runAgent`.

**Spec:** `docs/superpowers/specs/2026-11-25-three-home-ideas-design.md`

## Global Constraints

- No test suite exists; each task is verified by `pnpm lint` and `pnpm exec tsc --noEmit`, the last by `pnpm build` (ask the user to stop the dev server first).
- Migration must be re-runnable; pasted by the user at merge time.
- No emojis; sparse comments; en-GB dates.

## Review Focus

- A saved row from before this change (no `ideas`): must be made again once, not crash on `null`.
- The model returns fewer or more than 3 ideas: keep at most 3; show what came back.
- `another` on the last pill wraps to the first.
- A typed ask's card: `another` repeats the ask (call), not the pill cycle.
- `new ideas` while busy: button disabled.

---

### Task 1: Agent returns a list of ideas

**Files:**
- Modify: `src/lib/ai/suggestion-types.ts` (`TripIdea`)
- Modify: `src/lib/ai/registry.ts` (`propose_trip_idea` -> `propose_trip_ideas`)
- Modify: `src/lib/ai/agents/trip-idea.ts`
- Modify: `src/lib/ai/claude.ts` (export name)

**Interfaces:**
- Produces: `TripIdea { pill: string; label: string; body: string; plan: IdeaPlan }` (no `options`).
- Produces: `generateTripIdeas(prompt: string, count: number): Promise<TripIdea[]>`.

- [ ] Step 1: `TripIdea` drops `options`, adds `pill` (2 to 5 words, shown on the pill).
- [ ] Step 2: Tool `propose_trip_ideas`: top-level `{ ideas: array }`, each item the old idea object with `options` replaced by `pill`; required `["pill","label","body","plan"]`.
- [ ] Step 3: Agent input `{ prompt, count }`; `buildInput` appends `Give exactly ${count} idea(s), each a different destination and direction.`; system prompt drops the options sentence; `maxTokens: 6000`; `parseOutput` maps `ideas` (with today's plan fallback per item), `slice(0, 3)`, throws when empty.
- [ ] Step 4: `pnpm lint` and `tsc` show errors only in callers (Task 2/3).

### Task 2: Saved set in `home_ideas`

**Files:**
- Create: `supabase/migrations/20261125000004_home_ideas_set.sql`
- Modify: `src/lib/ai/home-idea-queries.ts`, `src/lib/ai/home-idea-actions.ts`, `src/lib/ai/suggestion-actions.ts`

**Interfaces:**
- Produces: `getHomeIdeas(workspaceId): Promise<{ fingerprint: string; ideas: TripIdea[] } | null>`; `saveHomeIdeas(workspaceId, { fingerprint, ideas })`.
- Produces: `refreshHomeIdeas(fresh: boolean): Promise<{ ideas?: TripIdea[]; error?: string }>`.

- [ ] Step 1: Migration: `add column if not exists ideas jsonb not null default '[]'`; `drop column if exists` label, body, options, plan.
- [ ] Step 2: Queries select/upsert `fingerprint, ideas`.
- [ ] Step 3: `refreshHomeIdeas`: same fingerprint and `ideas.length` -> return saved; else call with count 3, `fresh` adds `Not <labels> again.`, save.
- [ ] Step 4: `suggestForSurface` home: `(await generateTripIdeas(enriched, 1))[0]`.
- [ ] Step 5: lint + tsc clean outside `src/app/home`.

### Task 3: Pills open saved ideas

**Files:**
- Modify: `src/app/home/ideas-line.tsx`, `src/app/home/page.tsx`

- [ ] Step 1: Page passes `saved: TripIdea[]` (`savedIdeas?.ideas ?? []`).
- [ ] Step 2: State `ideas`, `open: number | null`, `oneOff: { ask: string; idea: TripIdea } | null`. Pill tap sets `open` (no call); active pill gets a `border-foreground` ring. Card for the open idea: `another` -> `(open + 1) % ideas.length`; dismiss -> `open = null`. Typed ask sets `oneOff`; its `another` repeats the ask.
- [ ] Step 3: `↻ new ideas` pill after the three, calls `refreshHomeIdeas(true)`, disabled while busy; on mount `refreshHomeIdeas(false)`.
- [ ] Step 4: `pnpm lint`, `tsc`, `pnpm build` pass.
- [ ] Step 5: Update `docs/TODO.md` (implemented, unverified, in-app checks from the spec); commit.
