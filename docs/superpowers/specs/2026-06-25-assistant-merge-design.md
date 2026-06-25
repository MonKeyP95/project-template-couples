# Merge "ask" + "AI mode" into one Assistant

**Date:** 2026-06-25
**Status:** Approved, ready for implementation
**Scope:** New `src/components/assistant.tsx`; edits to `src/app/layout.tsx` and
`src/components/ai-mode.tsx`; delete `src/app/trips/[slug]/layout.tsx` and
`src/app/trips/[slug]/trip-chat.tsx`.

## Problem

Two floating controls overlap on mobile: the global bottom-left **AI on/off** pill
(`AiFloatingToggle`, root layout) and the trip-only bottom-right **ask** button
(`TripChat`, trip layout). "AI off" doesn't even hide "ask" — two overlapping notions of
"AI". Merge them into one assistant control.

## Decision

**Global + chat-always-works.** One assistant on every app page; the chat always opens and
works (mock), and the on/off toggle (which gates the proactive suggestion cards + budget
drafter) moves into the assistant panel's header.

## What it does

New **`Assistant`** client component — the chat panel from `trip-chat.tsx`, generalised
off the trip and with the AI toggle in its header:

- A single floating launcher (`fixed bottom-5 right-5`, the existing "ask" button style).
  Hidden on landing + auth (`/`, `/signin`, `/signup`), matching today's `AiFloatingToggle`.
- Tapping opens the panel: header is `/ assistant` on the left, then the existing
  **`AiToggle`** switch + a close `×` on the right. Body is the mock chat
  (`requestChatReply` / `ChatMessage` from `@/lib/ai/chat`), input unchanged.
- Chat works regardless of AI on/off (preserves today's always-available "ask"). The toggle
  only governs the proactive surfaces elsewhere (`AiSuggestion`, the budget drafter), which
  keep reading `useAiMode()` as they do now.
- Empty-state hint generalised from "about your trip" to "packing, budget, ideas".

Mounted once in the **root layout** inside `AiModeProvider`, replacing `<AiFloatingToggle />`.
Because it lives in the root layout it persists across all navigation (the reason the trip
layout existed), so:

- `src/app/trips/[slug]/layout.tsx` is **deleted** (its only job was mounting `TripChat`).
- `src/app/trips/[slug]/trip-chat.tsx` is **deleted** (its chat logic moves into `Assistant`).

## `ai-mode.tsx` cleanup

`AiFloatingToggle` and its helpers (`AI_HIDDEN_PATHS`, the `usePathname` import) are removed
— the assistant now owns the launcher + hide-paths logic. **Kept:** `AiModeProvider`,
`useAiMode`, `persistAi`, and `AiToggle` (reused in the panel header and on `/profile`).

## Consequences

- The standalone bottom-left AI pill is gone; AI state is seen/changed inside the assistant
  panel (and still on `/profile`). The collapsed launcher shows "ask" with no at-a-glance
  on/off state — acceptable per the approved design; a state tint on the launcher is a
  possible later tweak.
- Chat is now available on every page, not just trips. Fine while it is a mock placeholder;
  when wired to a real model, `context` becomes page-aware.

## Out of scope

- Real model wiring, trip-aware chat context, persisted/shared history.
- Any change to how `AiSuggestion` / budget drafter gate on `useAiMode()`.
- The `/profile` AI toggle row (stays as-is).
