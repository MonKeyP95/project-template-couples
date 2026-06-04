# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Phases 1–3 complete; Phase 4 (Dream-Trip Pipeline), 4.5 (Trip Notes), and 4.6 (Itinerary Editing) shipped.** Foundation, auth + pairing, and the trip workspace are done: sand-and-sea design system, `/home`, `/trips/[slug]` with trips/packing/expenses/itinerary + RLS, Realtime packing, a settle-up budget (partial/overpay), per-trip notes, dark mode, and the desktop 3-col layout.

The itinerary is now a full **location-organized planner**: days grouped under editable locations that can carry an optional **date span**, **empty-day buffer slots** rendered between/across spans that you click to fill, and **gap-aware confirm-and-push** when an add lands on a taken date — single days, multi-day "added together" blocks (with names), and whole location spans all shift consistently (later days + later location spans move; empties are consumed; `end_date` follows). Dateless **dreams** have a parallel numbered itinerary and promote to dated trips.

**Next: Phase 5 — AI assistant** (Anthropic Claude via `lib/ai/claude.ts`), not yet wired; the moss-bordered `SuggestionCard` is its placeholder. Live punch list in `docs/TODO.md`.

### Commands
- `pnpm dev` — start dev server (Turbopack) on http://localhost:3000
- `pnpm build` — production build
- `pnpm start` — run production build
- `pnpm lint` — ESLint (flat config in `eslint.config.mjs`)
- `pnpm install` — install/refresh deps

There are no tests yet; do not invent a test command until one exists.

## What This Project Is

**Together** — a couples/families travel-planning app. Personal learning project that the user and their partner will actually use. Not a commercial product (yet); treat scope, polish, and operational concerns accordingly.

The differentiator vs. Cozi / Wanderlog / TripIt is that the center of gravity is **the shared trip**, with both partners contributing. See `docs/VISION.md`.

## Source-of-Truth Docs

Read the relevant one before making non-trivial design or scope decisions. Don't duplicate their content into code or new docs.

- `docs/VISION.md` — purpose, target users, "why us"
- `docs/FEATURES.md` — current MVP scope vs. later
- `docs/PLAN.md` — phases; **currently Phase 1 (Foundation)**
- `docs/DESIGN.md` — warm/calm visual language, mobile-first
- `docs/TECH.md` — stack, what's in MVP vs. added later
- `docs/DECISIONS.md` — non-obvious choices and why. Append a row when you make one.
- `docs/TODO.md` — running task list. Update after completing a task.

## MVP Scope (Phase 1–3)

The whole MVP is **three things**:
1. Auth + pairing (invite partner, shared workspace)
2. Create a trip (name, dates, destination, members)
3. Shared trip todo / packing list

Anything beyond this — budget, itinerary days, AI assistant, integrations — is **explicitly deferred.** If the user asks for something outside MVP scope at this phase, confirm before building it.

## Stack (current)

- **Next.js 16** (App Router, Turbopack) + **TypeScript 5** — *installed*
- **Tailwind CSS v4** (PostCSS plugin) — *installed*
- **React 19** — *installed*
- **Shadcn/ui** (style `base-nova`, primitives on `@base-ui/react`) — *installed and themed*; `button`, `input`, `dialog` under `@/components/ui`. `cn()` at `@/lib/utils`. Palette is the warm `DESIGN.md` set (OKLCH, light + warm-mocha dark) in `src/app/globals.css`. **Note**: this Button has no `asChild` prop — to style a `Link` as a button, use `buttonVariants(...)` directly.
- **Supabase** — Postgres + Auth + RLS + Realtime — *project provisioned, clients wired* (no tables yet)
- **`@supabase/ssr` 0.10** + **`@supabase/supabase-js` 2.106** — clients at `src/lib/supabase/{client,server}.ts`, session refresh in `src/proxy.ts`. No ORM. Cookie pattern: `getAll`/`setAll`.
- **Vercel** for deployment — *connected* (GitHub integration; push to `main` deploys prod, PRs get previews). Live at https://project-template-couples.vercel.app
- **Anthropic Claude** is added in Phase 5; do not wire it up early

Use the latest stable APIs (App Router patterns, Server Actions, `@supabase/ssr` client pattern).

## Architectural Principles

These come from `docs/TECH.md` and `docs/PLAN.md` — keep them in mind on every change:

- **Workspace, not couple.** Schema is `workspaces` + `workspace_members(user_id, role)` from day one. UI may assume 2 members; the data model must not.
- **RLS from day one.** Every shared table has Row-Level Security policies. No "we'll add it later."
- **AI provider is one file.** When Claude is wired in Phase 5, all calls route through `lib/ai/claude.ts`. No premature provider-agnostic abstraction.
- **Server-first.** Default to Server Components and Server Actions. Reach for client state only on real need.
- **Mobile-first.** Test on a phone viewport, not desktop.

## Working Style for This Repo

From the user's global instructions and project docs — these override default tendencies:

- **One small task at a time.** Validate each increment (build, run, look at the result) before moving on. Don't batch features.
- **Root cause before fix.** Reproduce, prove with evidence, then fix. No speculative patches or workarounds.
- **Don't over-engineer.** No defensive code, no abstractions for hypothetical needs, no error handling for impossible cases. This is a learning project — extra layers actively hurt.
- **No emojis** in code, prints, or logs.
- **Sparse comments.** Prefer clear names; comment only when WHY is non-obvious.
- **Short modules, short functions.** Name things clearly.
- **Keep `README.md` concise** — detail lives in `docs/`.
- **After completing a task**, update `docs/TODO.md`. If a non-obvious choice was made, add a row to `docs/DECISIONS.md`.

## Things to Push Back On

The user has explicitly asked for critical feedback. If a request would:

- Expand MVP scope beyond the 3 items above without finishing them first,
- Introduce an ORM, state library, or AI provider abstraction before the docs say to,
- Add defensive code or speculative abstractions,
- Or contradict a row in `docs/DECISIONS.md`,

…flag it and ask before doing it. Don't silently comply.

## Stack Versions (as of 2026-05)

Installed versions (locked in `pnpm-lock.yaml`): Next.js 16.2.6, React 19.2.4, Tailwind 4.3.0, TypeScript 5.9.3, ESLint 9.39.4. Node 24 / pnpm 11. To be added: Shadcn/ui (latest CLI), `@supabase/ssr` + `@supabase/supabase-js` (latest), and — only at Phase 5 — `@anthropic-ai/sdk` (latest).
