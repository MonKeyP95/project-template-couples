# Trip chat (mock)

Date: 2026-06-15
Status: approved (design)

## Goal

An open chat available across the trip workspace, so a couple can ask questions
(while planning the budget or any other time) and get answers from an assistant.
Built **mock-first**: the chat surface and seam are real, but replies come from a
deterministic placeholder — no API key, no cost, no real model yet. When the real
LLM is wired later, only the seam changes; the UI stays the same.

This is part of Phase 5. It does not install the Anthropic SDK, add an API route,
or add tables.

## Scope

In scope:
- A floating chat button on `/trips/[slug]` (all tabs) that opens a chat panel.
- A message list + text input; send a message, get a reply.
- A pure seam (`requestChatReply`) that returns a canned, honest placeholder reply
  now and becomes a real LLM call later.
- Conversation persists across tab switches (via a trip-segment layout).

Explicitly deferred:
- The real LLM: provider choice, API key, a server route (`/api/chat`) to keep
  the key secret, streaming, and cost. (Provider was deliberately left undecided.)
- Trip-aware context (name/dates/locations/budget/expenses) fed to the model —
  reserved as a `context` parameter, unused by the mock.
- Saved / shared chat history (survives reload, visible to the partner).

## Surface

A floating button fixed bottom-right on the trip workspace. Tapping it opens a
panel (slide-up / drawer) containing:
- A scrollable list of messages (user right-aligned, assistant left-aligned), in
  the existing sand-and-sea styling.
- A "typing…" indicator while a reply is pending.
- A text input + send button at the bottom; Enter sends, Shift+Enter newlines.
- A close affordance; an empty state inviting a question.

### Why a layout

The trip tabs navigate via `?tab=` (server navigations), so a chat mounted in
`page.tsx` would unmount and reset on every tab switch. A new
`src/app/trips/[slug]/layout.tsx` renders `{children}` plus the `<TripChat>`
client component. The layout instance persists across these same-segment
navigations, so the open conversation survives moving between tabs.

The layout receives `params` and passes the trip slug/id to `<TripChat>` (used
only for a future per-trip context/key; the mock barely needs it).

## The seam

A single module `src/lib/ai/chat.ts`:

```ts
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

/**
 * Mock: returns a deterministic, honest placeholder reply after a short delay.
 * Real later: becomes a fetch('/api/chat', …) (or the route calls the SDK);
 * `context` carries trip facts for the model. The chat UI is unchanged.
 */
export function requestChatReply(
  messages: ChatMessage[],
  context?: string,
): Promise<string>
```

Mock behaviour (deterministic, no network):
- Resolves after a short fixed delay (~600ms) so the UI exercises its pending /
  "typing…" state.
- The reply is an honest placeholder that never pretends to be a real answer,
  and echoes the user's latest question so it reads as a response. Example:
  *"I'm your trip assistant — but I'm not connected to a live model yet, so I
  can't really answer that. Once I'm wired up I'll help with: '<last question>'."*
- No randomness; same input → same reply.

### Migration to the real model (later, not now)

`requestChatReply` becomes a `fetch('/api/chat', { messages, context })`; a new
server route holds the provider client + key and (optionally) streams. The
`ChatMessage` type and the component are unchanged. Choosing the provider
(Claude vs a cheaper one) and adding the key happen then.

## Components

- `src/lib/ai/chat.ts` — `ChatMessage`, `requestChatReply` (mock).
- `src/app/trips/[slug]/trip-chat.tsx` — `"use client"`. Owns: open/closed state,
  `messages: ChatMessage[]`, input value, pending flag. On send: append the user
  message, set pending, `await requestChatReply(next, undefined)`, append the
  assistant reply, clear pending. Renders the FAB and the panel.
- `src/app/trips/[slug]/layout.tsx` — server component; renders `{children}` and
  `<TripChat tripSlug={params.slug} />`.

State note: all chat state is local `useState` in `TripChat`; no `useEffect`
seeding. Scroll-to-latest on new messages may use a ref + effect (DOM side effect,
allowed) — not for resetting state.

## Data flow

```
trips/[slug]/layout.tsx (persists across ?tab= switches)
  -> {children}  (the tab pages)
  -> TripChat (client)
       messages: ChatMessage[] in useState
       send -> requestChatReply(messages): Promise<string>  (mock, canned)
       append reply -> re-render
```

No server action, no API route, no DB in this slice.

## Error handling

`requestChatReply` (mock) cannot fail. The send handler still guards against
empty input and ignores sends while a reply is pending. When the real route lands,
a failed fetch shows an inline "couldn't reach the assistant" message and re-enables
the input.

## Testing

No test framework in this repo; do not invent one. Verification is `pnpm lint` +
`pnpm build` passing, plus a manual check: the chat button shows on every trip
tab; sending a message shows it, then a placeholder reply after the typing delay;
switching tabs keeps the conversation open.

## Files

- New: `src/lib/ai/chat.ts`
- New: `src/app/trips/[slug]/trip-chat.tsx`
- New: `src/app/trips/[slug]/layout.tsx`
- Edit: `docs/TODO.md`, `docs/DECISIONS.md`
