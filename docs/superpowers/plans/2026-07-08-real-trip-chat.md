# Real Trip Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side mock trip-chat reply with a real `claude-sonnet-5` call, grounded in basic trip facts, via a Server Action — UI unchanged.

**Architecture:** The pure mock `requestChatReply` (browser) is replaced by a `server-only` `chatReply` in `lib/ai/claude.ts` (Anthropic SDK) reached through a `"use server"` action `sendChatMessage`, which assembles a compact trip-context string from existing RLS-scoped queries. The floating `Assistant` client component keeps all its state and calls the action instead of the mock.

**Tech Stack:** Next.js 16 App Router (Server Actions), React 19 client component, `@anthropic-ai/sdk` (already installed and used by the discovery seam), Supabase (RLS) via existing query helpers.

## Global Constraints

- **No test framework exists; do not invent one.** Per-task verification is `pnpm lint` + `pnpm build` passing, plus a manual run for the user-visible task. (CLAUDE.md.)
- **AI provider is one file.** All model calls route through `lib/ai/claude.ts`. No provider abstraction. (CLAUDE.md / DECISIONS.)
- **Suggest-only / server-only seam.** Code under `lib/ai` returns data only and never reaches the browser; the API key stays server-side (`server-only` import in `claude.ts`).
- **Client components import types from `*-types.ts`**, never from a module that pulls `next/headers`. (Repo rule.)
- **Model:** `claude-sonnet-5`, in a `CHAT_MODEL` constant separate from the discovery `MODEL`.
- **European date display** is not relevant here (dates go to the model as raw ISO `YYYY-MM-DD`, not shown to the user).
- **No emojis** in code, logs, or prints.

---

### Task 1: Chat model seam (`chat-types.ts` + `chatReply` in `claude.ts`)

**Files:**
- Create: `src/lib/ai/chat-types.ts`
- Modify: `src/lib/ai/claude.ts` (add `CHAT_MODEL`, `chatSystem`, `chatReply`; add one import)

**Interfaces:**
- Produces: `ChatMessage` = `{ role: "user" | "assistant"; content: string }` (from `chat-types.ts`).
- Produces: `chatReply(messages: ChatMessage[], tripContext: string): Promise<string>` (from `claude.ts`).
- Consumes: the existing `anthropic` client and `Anthropic.TextBlock` filtering pattern already in `claude.ts`.

- [ ] **Step 1: Create the pure types module**

Create `src/lib/ai/chat-types.ts`:

```ts
/** Chat message shape shared by the client component and the server seam.
 * Kept provider-neutral (not an Anthropic type) so a future model/provider
 * swap only rewrites chatReply's body. Pure — safe to import from a client
 * component. */
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}
```

- [ ] **Step 2: Add the chat model constant and system-prompt helper to `claude.ts`**

In `src/lib/ai/claude.ts`, add the import near the top (with the other imports):

```ts
import type { ChatMessage } from "./chat-types"
```

Below the existing `const MODEL = "claude-sonnet-4-6"` line, add:

```ts
// Chat uses its own model constant so it can be dropped to a cheaper model
// (e.g. claude-haiku-4-5) without touching the web-search discovery flow.
const CHAT_MODEL = "claude-sonnet-5"

function chatSystem(tripContext: string): string {
  const base =
    "You are the in-app travel assistant for a couple planning and taking " +
    "trips together. Be warm, concise, and practical. Give concrete, " +
    "actionable answers; ask a brief clarifying question only when you " +
    "genuinely cannot answer otherwise."
  const context = tripContext.trim()
  return context ? `${base}\n\n${context}` : base
}
```

- [ ] **Step 3: Add `chatReply` to `claude.ts`**

Append this exported function to `src/lib/ai/claude.ts`:

```ts
/** A real, non-streaming assistant reply. Stateless: the full history is sent
 * each call. tripContext (empty off a trip page) is folded into the system
 * prompt. Suggest-only: returns text; it never writes. */
export async function chatReply(
  messages: ChatMessage[],
  tripContext: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: chatSystem(tripContext),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `pnpm lint`
Expected: no new errors (existing baseline). `chatReply` and `ChatMessage` are exported, so no unused-symbol warnings.

Run: `pnpm build`
Expected: build succeeds. (Nothing imports the new symbols yet; this only proves the seam type-checks.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat-types.ts src/lib/ai/claude.ts
git commit -m "feat(chat): real chatReply seam + ChatMessage type (slice 7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server action that assembles trip context (`chat-actions.ts`)

**Files:**
- Create: `src/lib/ai/chat-actions.ts`

**Interfaces:**
- Consumes: `chatReply` and `ChatMessage` (Task 1); `getCurrentWorkspace()` from `@/lib/workspace/queries` (returns `{ id, ... } | null`); `getTripBySlug(workspaceId, slug)` from `@/lib/trips/queries` (returns `TripHeader | null` with `id`, `name`, `country`, `startDate`, `endDate`, `fuzzyWhen`); `getItineraryLocations(tripId)` from `@/lib/trips/location-queries` (returns `ItineraryLocation[]`, each with `name: string`).
- Produces: `sendChatMessage(messages: ChatMessage[], tripSlug?: string): Promise<string>` (the Server Action the client calls).

- [ ] **Step 1: Create the action module**

Create `src/lib/ai/chat-actions.ts`:

```ts
"use server"

import { chatReply } from "@/lib/ai/claude"
import type { ChatMessage } from "@/lib/ai/chat-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripBySlug } from "@/lib/trips/queries"

/** Server Action behind the floating assistant. Builds basic trip context when
 * a trip slug is supplied, then calls the real model. Any failure (missing key,
 * network, model error) returns one honest inline message. */
export async function sendChatMessage(
  messages: ChatMessage[],
  tripSlug?: string,
): Promise<string> {
  try {
    const context = tripSlug ? await tripContextFor(tripSlug) : ""
    return await chatReply(messages, context)
  } catch {
    return "I couldn't reach the assistant just now — try again in a moment."
  }
}

async function tripContextFor(slug: string): Promise<string> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return ""
  const trip = await getTripBySlug(workspace.id, slug)
  if (!trip) return ""

  const locations = await getItineraryLocations(trip.id)
  const lines: string[] = [`The user is looking at their trip "${trip.name}".`]
  if (trip.country) lines.push(`Destination: ${trip.country}.`)
  if (trip.startDate && trip.endDate) {
    lines.push(`Dates: ${trip.startDate} to ${trip.endDate}.`)
  } else if (trip.fuzzyWhen) {
    lines.push(`When: ${trip.fuzzyWhen}.`)
  }
  if (locations.length) {
    lines.push(`Itinerary places: ${locations.map((l) => l.name).join(", ")}.`)
  }
  const mode = tripMode(trip.startDate, trip.endDate)
  if (mode) lines.push(mode)
  return lines.join(" ")
}

/** Planning vs on-the-road, dates-driven (the app's mode rule). Coarse server
 * Date compare on ISO YYYY-MM-DD strings; a same-day timezone edge is
 * irrelevant to this hint. Null when the trip has no dates. */
function tripMode(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const today = new Date().toISOString().slice(0, 10)
  if (today >= startDate && today <= endDate) {
    return "They are on this trip right now — give present, in-the-moment help."
  }
  if (today < startDate) {
    return "This trip has not started yet — help them prepare and plan."
  }
  return "This trip is in the past — help them reflect or plan a future one."
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `pnpm lint`
Expected: no new errors.

Run: `pnpm build`
Expected: build succeeds. (`sendChatMessage` is exported but not yet imported by the component — that lands in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/chat-actions.ts
git commit -m "feat(chat): sendChatMessage action builds basic trip context (slice 7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the assistant to the action, delete the mock, update docs

**Files:**
- Modify: `src/components/assistant.tsx`
- Delete: `src/lib/ai/chat.ts`
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

**Interfaces:**
- Consumes: `sendChatMessage` (Task 2) and `ChatMessage` (Task 1).

- [ ] **Step 1: Swap the imports in `assistant.tsx`**

In `src/components/assistant.tsx`, replace this import line:

```ts
import { requestChatReply, type ChatMessage } from "@/lib/ai/chat"
```

with:

```ts
import { sendChatMessage } from "@/lib/ai/chat-actions"
import type { ChatMessage } from "@/lib/ai/chat-types"
```

- [ ] **Step 2: Derive the trip slug from the path**

In `src/components/assistant.tsx`, just after the existing `const bottomPos = ...` block (before `function send()`), add:

```ts
  // "/trips/[slug]" or "/trips/[slug]/..." -> slug; undefined elsewhere.
  const tripSlug = pathname.match(/^\/trips\/([^/]+)/)?.[1]
```

- [ ] **Step 3: Call the action instead of the mock**

In `src/components/assistant.tsx`, inside `send()`, replace:

```ts
    requestChatReply(next).then((reply) => {
      setMessages((m) => [...m, { role: "assistant", content: reply }])
      setPending(false)
    })
```

with:

```ts
    sendChatMessage(next, tripSlug).then((reply) => {
      setMessages((m) => [...m, { role: "assistant", content: reply }])
      setPending(false)
    })
```

- [ ] **Step 4: Update the empty-state copy (no longer a placeholder)**

In `src/components/assistant.tsx`, replace the empty-state paragraph text:

```tsx
            Ask me anything — packing, budget, ideas. (I&apos;m a placeholder
            until I&apos;m connected to a real assistant.)
```

with:

```tsx
            Ask me anything — packing, budget, ideas for your trip.
```

- [ ] **Step 5: Delete the mock module**

```bash
git rm src/lib/ai/chat.ts
```

- [ ] **Step 6: Verify build, lint, and no stale references**

Run: `pnpm lint`
Expected: no errors, and no import still points at `@/lib/ai/chat`.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Manual run check**

Run: `pnpm dev`, open http://localhost:3000.
(If dev fails with a `0xc0000142` Turbopack panic on Windows, stop, delete `.next/`, and restart — known flake, not a code bug.)
Verify:
- On `/home`, open the assistant, send "what should I pack for a beach trip?" — a real answer returns after the `typing…` indicator.
- On a `/trips/[slug]` page, ask "what's my trip about?" — the reply references real trip facts (name / dates / locations).
- Switch tabs on the trip page — the open conversation persists (layout unchanged).

- [ ] **Step 8: Update docs**

In `docs/TODO.md`, add this paragraph directly under the `## Current Phase` block's existing bold entries (after line 4's phase summary, alongside the other "shipped" notes):

```markdown
**Real trip chat (slice 7): shipped 2026-07-08.** First mock-to-real AI swap. The floating `Assistant` chat now calls a real `claude-sonnet-5` model instead of the deterministic placeholder. The call moved server-side: new `chatReply` in `lib/ai/claude.ts` (own `CHAT_MODEL` constant, separate from discovery's `MODEL`), reached via a new `"use server"` action `sendChatMessage` (`src/lib/ai/chat-actions.ts`) that assembles basic trip context (name/dates/country/itinerary places + a planning-vs-on-the-road hint) from `getTripBySlug` + `getItineraryLocations` when open on a `/trips/[slug]` page. `ChatMessage` moved to `src/lib/ai/chat-types.ts` (client-safe); mock `chat.ts` deleted. Not gated by the AI toggle (chat always works). Non-streaming; deep context (budget/packing/notes), streaming, and saved history deferred. Spec: `docs/superpowers/specs/2026-07-08-real-trip-chat-design.md`. Plan: `docs/superpowers/plans/2026-07-08-real-trip-chat.md`.
```

In `docs/DECISIONS.md`, add this row to the top of the table (immediately under the `|---|---|---|` separator on line 6):

```markdown
| **Chat is the first mock-to-real AI swap: real `claude-sonnet-5` behind a server action, with its own `CHAT_MODEL` constant and a provider-neutral seam signature** | Honors "AI provider is one file" — `chatReply` lives in `claude.ts`, takes the app's own `ChatMessage[]` + a plain context string and returns a string, so swapping to a cheaper model is one constant and swapping provider is a one-function body rewrite (no abstraction built now, per YAGNI). Chat gets its own model constant so it can drop to Haiku without disturbing discovery's web-search flow, which wants a stronger model. The call moved server-side (the key can't ship to the browser) via a `"use server"` action that also builds basic trip context and the dates-driven planning/on-the-road hint. Not gated by the AI toggle — chat always works; the toggle only gates the proactive surfaces. | 2026-07-08 |
```

- [ ] **Step 9: Commit**

`src/lib/ai/chat.ts` is already staged for deletion by Step 5's `git rm`; this commit includes it alongside the component and docs changes.

```bash
git add src/components/assistant.tsx docs/TODO.md docs/DECISIONS.md
git commit -m "feat(chat): wire assistant to real model, drop mock (slice 7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **`ANTHROPIC_API_KEY` must be in the environment** (`.env.local` for dev, Vercel project env for prod) — the same key `discover()` already uses. Without it the model call throws and the user sees the inline "couldn't reach the assistant" message; the app still builds and runs.
- **Do not add** retries, request logging, rate limiting, or input truncation — out of scope, and against the repo's no-defensive-code rule.
- **Do not change** the assistant's open/close state, the `typing…` indicator, the layout persistence, or the AI-toggle behavior.
