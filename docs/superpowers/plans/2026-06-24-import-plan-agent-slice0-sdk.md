# Import-Plan Agent — Slice 0: Wire the Anthropic SDK (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross the mock→real line for AI in the smallest possible step — add `@anthropic-ai/sdk`, route a single real Claude call through the one-file seam `lib/ai/claude.ts`, and prove key/route/cost/latency in isolation. No importer UI yet.

**Architecture:** A server-only module `src/lib/ai/claude.ts` constructs the Anthropic client (reading `ANTHROPIC_API_KEY` from the server environment) and exposes one trivial `pingClaude()`. A throwaway route handler `GET /api/ai/ping` calls it so the round-trip can be exercised in a browser/curl. The API key never reaches the client — all access is server-side, matching the spec.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript 5, `@anthropic-ai/sdk` (latest), pnpm.

## Global Constraints

- **This is the first real-Claude wiring** (Phase 5 trigger per `docs/PLAN.md` and the spec). Until now `lib/ai/*` is mock-only; this slice adds the SDK but still writes nothing to the database.
- **No test framework exists.** Per `CLAUDE.md`, do not invent one. Verification is `pnpm build` (TypeScript typecheck + ESLint) passing, plus a **manual** `curl` of the ping route once the key is set. The build does **not** call the API, so it passes without a key; the curl step requires the key.
- **Server-only.** The Anthropic key is read from the server environment and never sent to the browser — hence the route-handler path. Do not import `lib/ai/claude.ts` into a `"use client"` component.
- **Provider stays one file.** All Claude calls route through `lib/ai/claude.ts` (per `CLAUDE.md` → "AI provider is one file"). No provider-agnostic abstraction.
- **Model:** `claude-sonnet-4-6` — the importer's chosen default in the spec; kept as a one-line `MODEL` constant so it can be A/B'd against Opus/Haiku later. (The spec explicitly selects Sonnet 4.6; do not substitute.)
- **No emojis** in code or copy.
- **Use `pnpm`** (never npm/yarn): `pnpm add @anthropic-ai/sdk`.

---

### Task 0: Console + key + spend cap (manual; one-time, no code)

This task has no code — it provisions the real-world dependency the rest of the slice needs. An engineer must complete it before the verification step in Task 3 can pass. It is its own task because it is a prerequisite gate a reviewer can check independently.

- [ ] **Step 1: Create the API key and a spend cap**

In the Anthropic Console (https://console.anthropic.com): create/sign in to an account, add a payment method, and create an API key (`sk-ant-...`). Set a **low monthly spend limit (e.g. $5)** under the workspace/billing limits so this learning project can't run up a bill. New accounts usually include a small free credit.

- [ ] **Step 2: Put the key in `.env.local` (gitignored), beside the Supabase keys**

Add this line to `.env.local` at the repo root (create the line; do not commit this file — it is already gitignored alongside the existing `NEXT_PUBLIC_SUPABASE_*` keys):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Do **not** prefix it with `NEXT_PUBLIC_` — that would expose it to the browser. The server reads it via `process.env.ANTHROPIC_API_KEY`.

- [ ] **Step 3: (prod, later) add the same env var in Vercel**

Not needed for local verification. When this eventually deploys, add `ANTHROPIC_API_KEY` as a Vercel Project Environment Variable (Production) — do this before any code that calls Claude ships to `main`.

---

### Task 1: Add the SDK dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via the package manager)

- [ ] **Step 1: Install the SDK**

Run: `pnpm add @anthropic-ai/sdk`
Expected: `@anthropic-ai/sdk` appears under `dependencies` in `package.json` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify the install builds**

Run: `pnpm build`
Expected: build succeeds (the new dependency is present but unused so far — fine).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(ai): add @anthropic-ai/sdk (Phase 5 slice 0)"
```

---

### Task 2: The Claude seam — `lib/ai/claude.ts` with `pingClaude()`

**Files:**
- Create: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (default export `Anthropic`; type `Anthropic.TextBlock`).
- Produces: `async function pingClaude(): Promise<string>` — a server-only function returning Claude's reply text.

- [ ] **Step 1: Create the module**

```ts
import "server-only"
import Anthropic from "@anthropic-ai/sdk"

/**
 * The single seam for Claude calls (CLAUDE.md: "AI provider is one file").
 * Server-only — the API key is read from the environment and never reaches the
 * browser. Slice 0 wires the SDK with one trivial call to prove
 * key/route/cost/latency in isolation; real features (the plan importer) land
 * here next, behind this same module.
 */

// The importer's default per the spec; a one-line swap to A/B against
// claude-opus-4-8 (cleaner first pass) or claude-haiku-4-5 (cheaper) later.
const MODEL = "claude-sonnet-4-6"

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from process.env

/** A trivial real round-trip. Returns Claude's reply text (expected: "pong"). */
export async function pingClaude(): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm build`
Expected: build succeeds. `pingClaude` is imported nowhere yet (fine). If the `import "server-only"` line errors with "Cannot find module 'server-only'", run `pnpm add server-only` (Next.js usually provides it transitively) and re-run `pnpm build`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(ai): claude.ts seam with a server-only pingClaude (slice 0)"
```

---

### Task 3: Smoke-test route `GET /api/ai/ping`

**Files:**
- Create: `src/app/api/ai/ping/route.ts`

**Interfaces:**
- Consumes: `pingClaude` from `@/lib/ai/claude`; `NextResponse` from `next/server`.
- Produces: a route handler — `GET /api/ai/ping` returns `{ reply: string }` on success, `{ error: string }` with status 500 on failure.

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server"

import { pingClaude } from "@/lib/ai/claude"

// Temporary slice-0 smoke test: GET /api/ai/ping returns Claude's reply, to
// prove the key, route, cost, and latency in isolation. Remove (or guard behind
// a non-prod check) once Slice 1's real importer route lands.
export async function GET() {
  try {
    const reply = await pingClaude()
    return NextResponse.json({ reply })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: build succeeds; the route `/api/ai/ping` appears in the route list.

- [ ] **Step 3: Manual smoke test (requires the key from Task 0)**

Run: `pnpm dev`, then in another terminal:

```bash
curl -s http://localhost:3000/api/ai/ping
```

Expected: `{"reply":"pong"}` (a real round-trip to Claude). Latency is typically 1–3s; the response confirms the key works, the SDK is wired, and the cost is a fraction of a cent. If you get `{"error":"..."}` with a 401, the key is missing/invalid in `.env.local` (restart `pnpm dev` after editing `.env.local`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/ping/route.ts
git commit -m "feat(ai): GET /api/ai/ping smoke test for the Claude seam (slice 0)"
```

---

## What this slice deliberately does NOT do

Per the spec, all of this is later slices — do not build it here:

- **`TripPlanProposal` type, the `propose_trip_plan` tool, structured extraction** — Slice 1.
- **Paste UI / review panel / confirm-and-apply** — Slice 1+.
- **Writing itinerary/locations/budget/notes** — Slices 1–3, via the existing Server Actions (`addItineraryDay`, location create, `saveBudgetItems`, `addNote`). The model only ever returns a proposal; a confirm handler writes.
- **Conflict resolution / extend-end-date / dream handling** — Slice 1+.

## Open question that gates Slice 1 (not this slice)

The spec lists one unresolved item to settle **before planning Slice 1**: the exact conflict-resolution verbs per section (Keep mine / Replace / Merge; Add / Skip; etc.). Slice 0 does not touch the review panel, so it is unblocked — but resolve that question in a short brainstorm before writing the Slice 1 plan.

## Next slices (each its own plan)

- **Slice 1 — itinerary + locations:** paste → `propose_trip_plan` tool call → editable review panel → confirm → existing Server Actions write. The meat. (Gated on the conflict-verbs question above.)
- **Slice 2 — budget items** into the same preview/apply.
- **Slice 3 — notes + dream trips.**
