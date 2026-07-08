# Real trip chat (slice 7)

Date: 2026-07-08
Status: approved (design)

## Goal

Replace the mock trip-chat reply with a real Claude call, grounded in basic
trip facts. The floating assistant UI and its "typing…" pending state stay
exactly as they are; only the seam behind `requestChatReply` changes. This is
the first mock-to-real AI swap (the discovery seam in `claude.ts` is already
real; chat, budget-planner, and suggestions are still mocks — this slice does
chat only).

## Scope

In scope:
- A real, non-streaming Claude reply for the floating assistant, model
  `claude-sonnet-5`.
- Basic trip context when the assistant is open on a `/trips/[slug]` page:
  trip name, dates, destination/country, and itinerary location list.
- A planning-vs-on-the-road mode hint derived from today's date against the
  trip dates, so the assistant's tone matches the moment.
- Moving the call server-side (the API key must never reach the browser).

Explicitly deferred (later slices):
- Streaming replies.
- Deep context (itinerary days, budget/expenses, packing, notes).
- Saved / shared chat history (survives reload, visible to the partner).
- Making budget-planner and suggestions real.

## Model and call shape

- Model: `claude-sonnet-5`, held in a new `CHAT_MODEL` constant in `claude.ts`,
  separate from the existing discovery `MODEL`. Chat can be dropped to a cheaper
  model (e.g. `claude-haiku-4-5`) by changing this one string without touching
  discovery.
- Non-streaming: the action returns the full reply string, which the existing
  `typing…` indicator already handles.
- Stateless: the full message history is sent each turn. The client already
  accumulates it and passes the whole array.

## Why the call moves server-side

The mock is a pure client-side function. A real key cannot ship to the browser,
so the call moves to a Server Action that runs `server-only` code. The UI does
not move — the client component keeps owning open/closed state, the message
list, the input, and the pending flag, and simply awaits a different function.

## The seam

`chatReply` in `src/lib/ai/claude.ts` (server-only), following the existing
Anthropic-SDK pattern in that file (a `new Anthropic()` call and text-block
extraction):

```ts
export async function chatReply(
  messages: ChatMessage[],
  tripContext: string,
): Promise<string>
```

- `messages` uses the app's own `ChatMessage` type (`{ role: "user" |
  "assistant", content: string }`), not any Anthropic type — the boundary stays
  provider-neutral, so a future provider swap only rewrites this function body.
- `tripContext` is a plain string (empty when off a trip page). It is folded
  into the system prompt.
- The system prompt sets the assistant's role (a couple's travel-planning
  helper), states the mode (planning vs on the road) when known, and injects
  `tripContext`. Returns the joined text of the reply's text blocks.

## Components and data flow

```
assistant.tsx (client)
  parse slug from usePathname()  ("/trips/[slug]" -> slug, else undefined)
  send -> sendChatMessage(messages, slug)   (server action)
        -> getCurrentWorkspace()            (RLS-scoped)
        -> if slug: getTripBySlug(workspaceId, slug)
                    getItineraryLocations(trip.id)
                    build tripContext string + planning/on-the-road mode
        -> chatReply(messages, tripContext) (server-only, Anthropic SDK)
        -> string reply
  append reply -> re-render
```

- `src/lib/ai/chat-types.ts` (new, pure): `ChatMessage`, moved out of the
  deleted `chat.ts`. A `"use server"` module can only export async functions,
  and `assistant.tsx` is a client component — repo rule: client components
  import types from `*-types.ts`, never from a module that pulls `next/headers`.
- `src/lib/ai/chat-actions.ts` (new, `"use server"`): `sendChatMessage(messages,
  tripSlug?)`. Resolves the workspace, assembles `tripContext` from the reused
  RLS-scoped queries `getTripBySlug` and `getItineraryLocations`, computes the
  mode, and calls `chatReply`.
- `src/lib/ai/claude.ts` (edit): add `CHAT_MODEL` and `chatReply`.
- `src/components/assistant.tsx` (edit): import `ChatMessage` from
  `chat-types.ts`; in `send`, call `sendChatMessage(next, slug)` instead of
  `requestChatReply(next)`. Slug parsed from `usePathname()`.
- `src/lib/ai/chat.ts` (delete): the mock is fully replaced.

### Mode (planning vs on the road)

The mode is dates-driven, matching the rest of the app. In the server action:
the current date within `[start_date, end_date]` inclusive means **on the
road**; otherwise **planning**. (Coarse server-`Date` comparison — a same-day
timezone edge does not matter for a planning-vs-on-the-road hint.) When the
trip has no dates, or the assistant is off a trip page, no mode is asserted. The mode is stated in the
system prompt so replies read appropriately (e.g. present, in-the-moment help on
the road vs preparation help while planning).

## Not gated by the AI toggle

Per the existing comment in `assistant.tsx`, chat always works; the AI on/off
toggle only gates the proactive surfaces (suggestion cards, budget drafter).
Real chat inherits that — every send hits the API. This relies on
`ANTHROPIC_API_KEY` in the environment, the same key `discover()` already uses.

## Error handling

No defensive layers. If the model call fails (missing key, network, model
error), `sendChatMessage` returns one honest inline assistant message —
"I couldn't reach the assistant just now — try again in a moment." — and the
input re-enables. The send handler still guards empty input and ignores sends
while a reply is pending (unchanged).

## Testing

No test framework in this repo; do not invent one. Verification is `pnpm lint`
+ `pnpm build` passing, plus a manual check:
- On `/home`, open the assistant and ask a general question — a real answer
  comes back after the typing indicator.
- On a `/trips/[slug]` page, ask about the trip — the answer references real
  trip facts (name/dates/locations).
- Switching tabs keeps the conversation open (layout persistence unchanged).

## Files

- New: `src/lib/ai/chat-types.ts`
- New: `src/lib/ai/chat-actions.ts`
- Edit: `src/lib/ai/claude.ts`
- Edit: `src/components/assistant.tsx`
- Delete: `src/lib/ai/chat.ts`
- Edit: `docs/TODO.md`, `docs/DECISIONS.md`
