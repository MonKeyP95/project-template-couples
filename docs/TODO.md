# TODO.md

## Current Phase
**Phase 1 — Foundation**

## Next small tasks (do one at a time)
1. ~~Initialize Next.js project here with TypeScript + Tailwind~~ **Done 2026-05-25** — Next 16.2.6, React 19.2, Tailwind v4, pnpm, App Router, `src/`, Turbopack. `pnpm dev` → http://localhost:3000 returns 200.
2. ~~Add Shadcn/ui and install a few base components (button, input, dialog)~~ **Done 2026-05-25** — shadcn 4.8 with `base-nova` style and `neutral` base color. Built on `@base-ui/react`. `button`, `input`, `dialog` installed. `cn()` helper at `src/lib/utils.ts`. Theme tokens in `src/app/globals.css`. `pnpm build` clean.
3. ~~Create Supabase project, add `.env.local` with URL + anon key~~ **Done 2026-05-25** — project ref `zctbypyfvebhildcdkto`, URL + publishable/anon key in `.env.local` (gitignored). `.env.example` committed as template. Connectivity verified via `GET /auth/v1/settings` → HTTP 200.
4. ~~Wire `@supabase/ssr` client (browser + server)~~ **Done 2026-05-25** — `@supabase/ssr` 0.10 + `@supabase/supabase-js` 2.106 installed. Clients at `src/lib/supabase/{client,server}.ts`. Session refresh in `src/proxy.ts` (Next 16's renamed middleware convention; Node runtime). Verified: `proxy.ts` runs on `GET /` in dev (proxy timing visible in Next log), build clean, no deprecation warnings.
5. ~~Build minimal landing page in the project's warm style. Swap globals.css palette from neutral to warm pink/teal/off-white per DESIGN.md.~~ **Done 2026-05-25** — editorial-style landing at `/` with Instrument Serif + Hanken Grotesk + JetBrains Mono via `next/font/google`. Full warm palette in `globals.css` (OKLCH tokens, light + dark). Soft peach/teal radial-gradient atmosphere. Staggered fade-in on load. Mobile-first, tested at 390px and 1440px. Prod build clean.
6. Push to GitHub, connect Vercel, confirm deploy works

## Phase 2 — Auth + Pairing (next up)
- Email/password sign-up + log in (Supabase Auth)
- `workspaces` table with members + roles (RLS on)
- Invite flow: one member sends a link, the other joins the workspace
- Basic profile (name, avatar)

## Phase 3 — First Trip (after Phase 2 works)
- `trips` table (workspace_id, name, dates, destination)
- Create a trip from the workspace
- `trip_items` table (todo / packing item, checked, assignee)
- Real-time updates between the two devices

## Working rules
- One task per session. Finish, validate, then move on.
- After completing a task, check it off here and add a row to `DECISIONS.md` if anything non-obvious was chosen.
- If a task feels too big mid-session, split it on this page.
