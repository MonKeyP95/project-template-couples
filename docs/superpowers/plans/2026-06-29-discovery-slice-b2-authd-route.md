# Discovery Slice B2 — Auth'd Preference-Aware Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the body-driven smoke `/api/ai/discover` into the real endpoint: AI-mode + auth gated, loading the couple's saved dining preferences server-side and merging them into the search query. Doors unchanged.

**Architecture:** A thin enrichment seam. The route takes only `{ destination, when }` from the body (what a door knows), resolves the workspace via `getCurrentWorkspace()`, loads preferences via slice A's `getDiningPreferences(workspaceId)`, builds the existing `RestaurantQuery`, and calls the unchanged `searchRestaurants`. Preferences are server-authoritative.

**Tech Stack:** Next.js 16 route handler, TypeScript 5, Supabase (server client via existing queries). No new dependencies, no schema change.

## Global Constraints

- **No test runner exists.** Per CLAUDE.md, validate with `pnpm lint` then `pnpm build`; the final step is a manual authenticated API check. No `*.test.ts`.
- **One file changes:** `src/app/api/ai/discover/route.ts`. Do not touch `claude.ts`, `searchRestaurants`, `RestaurantQuery`, the on-the-road door, or `proxy.ts`.
- **Preferences-only enrichment** (spec §7): the body carries only `destination` + `when`; `budgetBand`/`vibeTags`/`dietary`/`cuisines` come from `getDiningPreferences`, never the body.
- **AI provider is one file** — no SDK access added here; the route only calls existing seams.
- **Suggest-only** — the route reads preferences and returns suggestions; it writes nothing.
- **No emojis;** sparse comments.
- Commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Interfaces this task consumes (exact signatures)

- `getCurrentWorkspace(): Promise<CurrentWorkspace | null>` from `@/lib/workspace/queries` — `CurrentWorkspace` has `id: string`; returns `null` when unauthenticated or workspace-less.
- `getDiningPreferences(workspaceId: string): Promise<DiningPreferences>` from `@/lib/preferences/dining-queries` — `DiningPreferences = { budgetBand: BudgetBand; vibeTags: string[]; dietary: string[]; cuisines: string[] }`; returns `EMPTY_DINING_PREFERENCES` when unset.
- `isAiEnabled(): Promise<boolean>` from `@/lib/ai/ai-mode`.
- `searchRestaurants(query: RestaurantQuery): Promise<RestaurantSuggestion[]>` from `@/lib/ai/claude`.
- `RestaurantQuery` from `@/lib/ai/restaurant-discovery-types` — `{ destination, when, budgetBand, vibeTags, dietary, cuisines }`.

---

### Task 1: Rewrite the route to auth + load preferences

**Files:**
- Modify (full rewrite): `src/app/api/ai/discover/route.ts`

**Interfaces:**
- Consumes: the five listed above.
- Produces: `POST /api/ai/discover` — body `{ destination: string; when?: string }` → `{ suggestions: RestaurantSuggestion[] }` (200); `{ error }` on 403 (AI off), 401 (no session/workspace), 400 (no destination), 500 (search failure). Same response shape the on-the-road door already consumes.

- [ ] **Step 1: Replace the file contents**

```ts
import { NextResponse } from "next/server"

import { searchRestaurants } from "@/lib/ai/claude"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import type { RestaurantQuery } from "@/lib/ai/restaurant-discovery-types"

// POST /api/ai/discover: one real web-search-backed Claude call returning a
// cited restaurant shortlist for the couple. AI-mode-gated (the `ai` cookie) and
// auth-gated (the proxy requires a session). The body carries only what a door
// knows — destination + when; the couple's saved dining preferences are loaded
// server-side and merged into the query (preferences are server-authoritative).
export async function POST(request: Request) {
  if (!(await isAiEnabled())) {
    return NextResponse.json({ error: "AI mode is off." }, { status: 403 })
  }

  const workspace = await getCurrentWorkspace()
  if (!workspace) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      destination?: string
      when?: string
    }
    const destination = String(body.destination ?? "").trim()
    if (!destination) {
      return NextResponse.json(
        { error: "destination required." },
        { status: 400 },
      )
    }

    const prefs = await getDiningPreferences(workspace.id)
    const query: RestaurantQuery = {
      destination,
      when: String(body.when ?? "soon").trim(),
      budgetBand: prefs.budgetBand,
      vibeTags: prefs.vibeTags,
      dietary: prefs.dietary,
      cuisines: prefs.cuisines,
    }

    const suggestions = await searchRestaurants(query)
    return NextResponse.json({ suggestions })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors. (`RestaurantQuery.budgetBand` is `string`; `prefs.budgetBand` is the `BudgetBand` string-union subtype — assignable, no cast needed.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles clean; `/api/ai/discover` still listed in the route table.

- [ ] **Step 4: Manual authenticated verification**

This route now requires a session, so it cannot be curled unauthenticated (that is the point). Verify through a logged-in session:

1. `pnpm dev`; sign in in the browser; turn AI mode on.
2. Open `/profile`, set dining preferences to something distinctive (e.g. cuisines = "sushi, ramen"; budget = "splurge"). Save.
3. Trigger a discovery call (either the on-the-road door on an active trip, or — to inspect JSON directly — copy the browser's session cookies into a `WebSession` and POST `{ "destination": "Lisbon, Portugal", "when": "dinner tonight" }` to `http://localhost:3000/api/ai/discover`).
4. Confirm results visibly lean toward the set preferences (Japanese-leaning, upscale).
5. Clear the preferences (empty) and repeat: results should be a broad, still-non-empty shortlist (the slice-B1 prompt fix guarantees a search even with sparse preferences).
6. Confirm gates: AI off → 403; signed out → the proxy redirects to `/signin` (the route is no longer public).

Expected: preference-set call is visibly narrower than the empty-preference call; both return cited suggestions; gates behave as listed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/discover/route.ts
git commit -m "feat(ai): auth'd, preference-aware /api/ai/discover (slice B2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§7):**
- One file changes, doors/`claude.ts`/types untouched → Task 1 scope + Global Constraints. ✓
- Keep `isAiEnabled()` 403; assume authenticated → Step 1 keeps the gate; relies on the proxy. ✓
- Resolve workspace → preferences via `getCurrentWorkspace` + `getDiningPreferences` → Step 1. ✓
- Body carries only `{destination, when}`; preferences server-authoritative → Step 1 reads only those two body fields. ✓
- Drop the "temporary smoke route" comment → Step 1's new comment. ✓
- 401 when no workspace → Step 1. ✓

**Placeholder scan:** none — the full file is given.

**Type consistency:** `getCurrentWorkspace` → `.id` used for `getDiningPreferences(workspace.id)`; `DiningPreferences` fields map 1:1 onto `RestaurantQuery`'s preference fields; `searchRestaurants` takes the assembled `RestaurantQuery`. Response `{ suggestions }` matches what the on-the-road door reads. ✓
