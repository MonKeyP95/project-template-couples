# TECH.md

## MVP Stack (what we use from day one)

- **Next.js 16** (App Router, Turbopack) + **TypeScript 5**
- **Tailwind CSS** + **Shadcn/ui** (day one, not "maybe later")
- **Supabase** — Postgres + Auth + RLS + Realtime
- **`@supabase/ssr`** + **`supabase-js`** as the only data layer for now (no ORM)
- **Vercel** for deployment

That's it. Anything else is added when we have a concrete need.

## Added in later phases (only when needed)

- **Anthropic Claude** — added in Phase 5 for the AI assistant. Wrap calls in a single module so the provider can be swapped later. **No** "provider-agnostic" abstraction up front.
- **Zod** — when the first form gets validation that's annoying without it.
- **Zustand** — only if a real client-state need shows up. Most state in App Router is server state.
- **Drizzle ORM** — revisit at Phase 4+ if `supabase-js` queries get gnarly. Not before.

## External integrations (Phase 6, optional)

- Google Calendar API
- Google Maps Platform
- Restaurant booking (depends on what services have usable APIs at the time)

These are added one at a time, only if we'd actually use them on our own trips.

## Why this stack

- **Next.js 16** — backend (Route Handlers, Server Actions) and frontend in one repo; good fit for AI streaming. Turbopack is the default dev bundler.
- **Supabase** — auth, Postgres, RLS, realtime in one product. Removes weeks of glue code for a personal project.
- **Shadcn/ui** — owned components in our repo, fully themable to the warm/calm design language.
- **Claude (Phase 5)** — strong at planning/structuring tasks (itinerary drafting). Single provider keeps complexity down.

## Architectural principles

- **Workspace, not couple.** Schema uses `workspaces(id)` and `workspace_members(workspace_id, user_id, role)` from day one. MVP UI assumes 2 members; the data model doesn't.
- **RLS from day one.** Every shared table has Row-Level Security. No "we'll add it later."
- **AI provider is one file.** When Claude is wired up, all calls go through `lib/ai/claude.ts`. Swapping providers later is a one-file change, not a refactor.
- **Server-first.** Default to Server Components and Server Actions. Reach for client state only when something genuinely needs it.
