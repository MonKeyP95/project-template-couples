# AI Assistant Log rail — design

**Date:** 2026-06-24
**Status:** Draft (design approved in brainstorm; not yet built)

## Problem

The desktop trip page has a right rail (`DesktopRightRail` in `src/app/trips/[slug]/page.tsx`) whose top block is a "Pre-trip" panel: three progress bars (Packing done/total, Budget spent/planned, Saved saved/planned), with a 7-day weather grid below.

Those three numbers are **redundant** — each already lives inside its own tab — and don't drive any action at a glance. The space is better spent on something the rest of the UI doesn't already give you.

## Concept

Replace the Pre-trip progress block with an **Assistant** panel: a calm, scrollable, chronological **log of the trip's AI activity**, with "Claude Code vibes." You can see *what* the assistant suggested and *why*, scroll back through what's already been discussed, and it reads as one continuous timeline rather than a set of dismissible cards.

The 7-day weather grid stays, pinned **below** the Assistant panel. Only the Pre-trip progress block is removed.

This is desktop-only (the rail is `hidden lg:flex`). Mobile keeps the floating "ask" button; see Mobile below.

## Timeline model

One log **per trip** (not per location). A single unified stream interleaves, in chronological order:

- **Suggestions** — proactive entries the assistant raises, each carrying a short **reasoning** ("why" this was suggested).
- **You** — questions/messages the user sends.
- **Assistant** — replies to the user.

Each entry has:

- `kind`: `suggestion` | `user` | `assistant`
- `body`: the text
- `createdAt`: timestamp (drives ordering and the calm, log-like read)
- `locationId` (optional): a **location tag**. Entries can reference an itinerary location ("for Funchal…"); untagged entries are trip-wide.
- `reason` (suggestions only): the one-line "why."

The panel supports **scrolling the full history** and **filtering by location**. Trip-wide (untagged) entries always show. Topics that aren't location-bound (total budget, savings, dates) live in the same per-trip timeline, untagged.

## On/off behavior

The **log is always visible** — you can always read what's been discussed, regardless of the AI toggle.

The AI on/off toggle controls whether the assistant is **active** (generating new suggestions and replies), not whether the log shows:

- **AI on** — the assistant proposes suggestions and answers questions; new entries append.
- **AI off (default)** — you can read and scroll the existing log, but no new AI activity is generated; the "ask" input is dimmed / invites you to turn AI on.

This reconciles "show the log even when off" with the project's "AI is suggest-only, off by default" stance: the *record* is always there; the *activity* is gated.

The on/off toggle moves into the Assistant panel **header** on desktop. The floating toggle (`AiFloatingToggle`) remains on mobile.

## How it absorbs today's AI pieces

- **Per-tab suggestion cards** (`AiSuggestion` / `SuggestionCard`, currently shown only when AI is on) fold into the timeline as `suggestion` entries with a `reason`. The inline cards in tabs can go away (or remain as a thin pointer to the rail — TBD during build).
- **Chat** (`TripChat`, the floating "ask") folds into the timeline: the user's messages become `user` entries and replies become `assistant` entries. On desktop the conversation happens in the rail; on mobile the floating "ask" opens the same timeline.
- **Budget drafter** (`BudgetDrafter`) stays in the budget tab — it's a stepped editor wired into budget items and doesn't belong in a generic rail. When used, it can **post a summary entry** to the log ("Drafted a €X budget across N categories").

## Persistence

**Target:** a stored, **shared** log — a `trip_ai_log` table (entries scoped to `trip_id`, RLS by workspace membership, optional `location_id`). Both partners see the same history; it survives reloads and is shared across devices. This matches the couples-app premise (both contribute, both see).

**Reality:** AI is still a Phase-5 mock (`lib/ai/*` is deterministic, no SDK). Persisting placeholder reasoning to a real table is premature. So:

- **First slice** renders the timeline from the existing mock sources (`suggestionFor(surface)` and the mock chat) in **session/in-memory** state, to prove the feel and layout.
- The stored `trip_ai_log` table and the shared, real-Claude-fed log land **when Claude is wired** (one-file swap behind the `lib/ai` seam, per the project's AI seam approach).

## Mobile

The rail does not exist on mobile. There, the floating **"ask"** button opens the same per-trip timeline as a bottom sheet (reusing the timeline component). Detailed mobile layout is deferrable to a follow-up; the first slice can keep the existing floating chat on mobile and focus the new timeline on the desktop rail.

## First slice (to build first; mock, no DB)

1. Remove the "Pre-trip" progress block from `DesktopRightRail`; keep weather below.
2. Add an **Assistant** panel in its place: header (label + AI on/off toggle) and a scrollable timeline.
3. Render the timeline from the existing mock suggestions + an in-session chat, as a unified chronological stream, with `kind`-styled entries and a `reason` line on suggestions.
4. Location tags + filter on entries (tags can be stubbed from the surface/location context available client-side).
5. On/off-aware state: read-only log + "turn on AI" invite when off.

No `trip_ai_log` table, no Claude calls in this slice.

## Out of scope / deferred

- Real Claude integration and the stored `trip_ai_log` table (lands with Phase 5 wiring).
- Acting on a suggestion from the log (e.g. "apply" buttons that mutate the trip) — informational entries only for now.
- Full mobile timeline sheet (first slice keeps the existing floating chat on mobile).
- Removing the in-tab suggestion cards vs. keeping them as pointers — decided during build.

## Open questions

- Exact visual density of an entry (avatar/icon per kind, how the "why" reads) — settle during build against the design system.
- Whether the budget drafter's "summary entry" is in the first slice or a follow-up.
