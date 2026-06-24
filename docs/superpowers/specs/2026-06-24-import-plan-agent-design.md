# Import a plan — agent that turns an external trip plan into a trip skeleton

**Status:** Design (brainstormed 2026-06-24). Not yet planned or built.
**Phase:** 5 (AI assistant). This is the feature that first wires real Claude.

## Problem / why

People plan trips with an LLM (ChatGPT), a Google Doc, or notes, then re-type it
all into the app by hand. The idea: paste that plan and have an agent lay out the
trip skeleton — itinerary, locations, budget, notes — for the couple to review and
accept. Logged in `docs/TODO.md` as a "Later (needs real Claude)" item; this spec
makes it concrete.

## The one thing that makes this different from every prior AI slice

Every AI surface today is **mock-first and suggest-only** — `planBudgetSteps`,
`suggestionFor`, `requestChatReply` are deterministic stubs, and code under
`lib/ai` never writes (see `memory/project-ai-seam-mock-first.md`). An importer
**cannot** be meaningfully mocked: its entire value is a real model reading messy
free-form text and producing structure. So this feature ≈ "wire
`@anthropic-ai/sdk` for the first time." It's a bigger step than prior slices and
is the natural Phase 5 trigger.

The suggest-only invariant is **preserved**: `lib/ai` only ever *returns* a
`TripPlanProposal`. All writes go through the existing Server Actions
(`addItineraryDay`, location create, `saveBudgetItems`, `addNote`). The model
never writes — a confirm handler does.

## Scope — what the agent populates

All four content types a pasted plan contains:

1. **Itinerary** — days + per-day events (time + text).
2. **Locations** — with optional date spans (the existing location model).
3. **Budget items** — located (inherit a location's dates) or trip-wide (own
   `when_start`/`when_end`, per migration `20260617000002_budget_item_dates.sql`).
4. **Notes** — loose tips / restaurant ideas → `trip_notes`.

## Input

**Paste text only** for the first version. A textarea — paste from ChatGPT, a
doc, notes. Zero new dependencies, no file storage. File upload (.docx/.pdf) and
Google Docs links are explicitly out of scope for now.

## Entry point

An **"Import a plan"** action on **both the Itinerary tab and the Budget tab**,
opening **one shared importer / one Claude call / one draft**. A pasted plan is a
single document that almost always mixes days, costs, and tips, so splitting into
"budget-only" vs "itinerary-only" importers would either discard found content or
re-parse twice. The review panel is section-aware about where it was opened from
(launched from Budget → emphasize/scroll to the Budget section; footer may read
"Add to budget"), but it's the same proposal and the same commit handlers.

## Flow

1. Tab → **Import a plan** → paste panel (textarea + **Read plan** button).
2. Text posts to a route handler that calls `lib/ai/claude.ts`. Claude returns a
   structured `TripPlanProposal`. **Nothing is written.**
3. The proposal renders as an **editable review panel inside the tab** —
   moss-bordered (the existing `SuggestionCard` "AI, not yet committed" tone).
4. **Add to trip** runs the confirm handler → existing Server Actions write.

### What "the draft" looks like

A green-bordered review panel that takes over the tab (not a modal, not a new
page). It shows a one-line summary (e.g. "2 locations · 3 days · 4 budget lines ·
2 notes"), then sections for Locations / Days / Budget / Notes. Clean rows are
pre-ticked (one-click). Conflicts are highlighted in amber with inline choices.
A sticky footer: **Cancel** / **Add to trip · N items**. Once committed, imported
rows are **indistinguishable** from hand-entered ones — the proposal is transient
(in-memory only, never persisted as a file/table) and disappears once the real
rows exist.

## Review model — always-on preview, cheap when it can be

Decision: **not** pure auto-apply, even on an empty trip. One always-on preview
gate that collapses to one click when there's nothing to conflict with.

- **Empty trip / no conflicts** → preview is a summary + one button ("… → Add to
  trip"). Feels almost like auto-apply.
- **Existing data** → the *same* preview flags conflicting rows and only those
  need a decision; clean rows still apply in one click.

Rationale: (a) "empty trip" is the rare case — by the time someone pastes a plan
they've usually created the trip with dates and maybe a location, so the
conflict path is the main path, not an edge case; (b) the model *will*
hallucinate a day / merge locations / invent a price, and a bad import on an
empty trip means hunting down wrong rows by hand — a 5-second glance is cheap
insurance; (c) one preview mechanism is one code path, not two. This mirrors the
itinerary's existing gap-aware confirm-and-push instinct (act freely until
something's taken, then ask) — just always-on instead of mode-switched.

## Dates & conflicts

- **Dated trip:** plan Day 1 → trip `start_date`, consecutive. The trip's real
  dates win over any dates inside the pasted plan.
- **Dream (no dates):** drop into the dream numbered itinerary (`day_index`), no
  calendar.
- **Plan longer than the trip's range:** the preview **flags it and offers a
  one-tap "extend end date"** (chosen over silently truncating or
  silently auto-extending — nothing lost, nothing surprising).
- **Existing-content collision** (target date already has a day; location span
  overlaps; a budget line already exists for a place): that row needs a decision
  in the preview (Keep mine / Replace / Merge, Add / Skip, etc.).

## How Claude returns structure

Single call, **structured output via tool use** — Claude calls one
`propose_trip_plan` tool whose schema *is* `TripPlanProposal`. One round-trip,
reliable typing, no brittle "parse JSON out of prose." This is an extraction
task (the simplest LLM tier), not an agent loop.

Pasted text is untrusted input, but since it only ever yields a proposal the user
reviews before any write, prompt-injection risk is low — worth a one-line note in
the implementation, not a mitigation layer.

## Data model — no new tables

`TripPlanProposal` is a plain typed object in `lib/ai`, transient (never
persisted):

- `locations[]` — name + optional span
- `days[]` — day index (or anchored date) + summary + `events[]` (time + text)
- `budget[]` — category · subject · amount · located-vs-trip-wide
- `notes[]` — loose tips / restaurants

Reuses `itinerary_days` / `dream_itinerary_days`, locations, `trip_budget_items`,
`trip_notes` exactly as they are. No migrations.

## Model & cost

- **Default: Claude Sonnet 4.6** (`claude-sonnet-4-6`). Strong at structured
  extraction over messy text; ~4 cents per import. The model id is a one-line
  config in `lib/ai/claude.ts` so it can be A/B'd against Opus 4.8 (cleaner
  first pass, ~6.5c) or Haiku 4.5 (~1.5c, more review friction) on real plans.
- Cost is a non-issue at this scale (a handful of imports per trip) — the
  spread between cheapest and best is ~5 cents per import. Pick for *fewest
  mistakes*, because every mistake lands in the review panel. The review gate is
  what makes any model choice safe.

## Billing / setup (real-world dependency this feature adds)

The deployed app calls Claude with its **own Anthropic API key**, billed
separately from the Claude Code build session.

- Create an account in the Anthropic Console, add a payment method, create an API
  key (`sk-ant-...`).
- Store it server-side only: `.env.local` locally (gitignored, beside the
  Supabase keys), Vercel env var in prod. Never sent to the browser — hence the
  route handler / Server Action path.
- Pay-as-you-go (prepaid credits recommended); new accounts usually get a small
  free credit. **Set a low monthly spend cap (e.g. $5)** in the Console so a
  learning project can't be surprised by a bill.

## Slicing (incremental, validate each step)

- **Slice 0 — wire the SDK (no UI).** Add `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`
  env var, billing + spend cap, a trivial real call behind `lib/ai/claude.ts`.
  Proves key/route/cost/latency in isolation — the lowest-risk way to cross the
  mock→real line.
- **Slice 1 — itinerary + locations** (dated trips): paste → parse → preview →
  apply. The meat.
- **Slice 2 — budget items** into the same preview/apply.
- **Slice 3 — notes + dream trips.**

Each slice is independently shippable and testable.

## Out of scope (for now)

File/doc upload, Google Docs links, importing into a trip from the new-trip flow,
a global/top-level entry point, persisting the proposal, re-running against logged
expenses, provider abstraction beyond the existing one-file `lib/ai` seam.

## Open questions to confirm before planning

- Slice 0 isolated vs folded into Slice 1 (recommended: isolated).
- Exact conflict-resolution verbs per section (Keep mine / Replace / Merge …).
