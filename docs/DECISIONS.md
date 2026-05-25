# DECISIONS.md

## Important Decisions & Why

| Decision | Why | Date |
|---|---|---|
| Position as a **couples/families travel app**, not a generic household organizer | Crowded space (Cozi/FamCal) when generic; clear differentiator when trip-centric. Personal use case is travel. | 2026-05-25 |
| Product name: **Together** | Picked one name and stuck with it; previously inconsistent ("LifeTogether" vs. "Together"). | 2026-05-25 |
| Model shared surface as **workspace with members + roles**, not strict 2-person "couple" | Same schema scales from couple → family → small group without rewrite. MVP just hides the multi-member UI. | 2026-05-25 |
| **Drop Drizzle from MVP**, use `supabase-js` directly | Drizzle + Supabase RLS is friction-heavy. `supabase-js` is enough until queries get complex. Revisit at Phase 4+. | 2026-05-25 |
| **One AI provider** (Anthropic Claude) for MVP, not a provider-agnostic abstraction | Premature abstraction before any AI feature exists. Wrap calls in one module so swapping later is cheap. | 2026-05-25 |
| **Shadcn/ui on day one** | Standard pairing with Next.js + Tailwind in 2026; deferring it just rewrites components later. | 2026-05-25 |
| Next.js 16 + TypeScript + Supabase | Beginner-friendly, fast to iterate, good fit for AI features and real-time shared data. Scaffolder pulled Next 16 (newer than the Next 15 originally planned for); accepted as the current stable. | 2026-05-25 |
| **pnpm** as package manager, **Tailwind v4** (PostCSS plugin), **`src/` directory**, **Turbopack** dev bundler | All defaults of `create-next-app@latest` in May 2026. Accepted rather than overriding — they're the path of least surprise for future contributors and current docs. | 2026-05-25 |
| **Approve build scripts for `sharp` + `unrs-resolver`** in `pnpm-workspace.yaml` | pnpm 11 requires explicit opt-in for postinstall scripts. `sharp` powers `next/image` optimization; `unrs-resolver` is used by ESLint. Both are first-party deps of the scaffold. | 2026-05-25 |
| Shadcn style: **`base-nova`** with **`neutral`** base color (current `create-next-app` defaults) | Accepted defaults to get unblocked. Palette will be re-themed to the warm pink/teal in `DESIGN.md` at task 5 (landing page). | 2026-05-25 |
| Shadcn primitives: **`@base-ui/react`**, not Radix | shadcn 4.x ships components on `@base-ui/react`. Don't add `@radix-ui/*` packages; it's no longer the underlying layer. | 2026-05-25 |
| **`shadcn` is a runtime dep**, not just a CLI | shadcn 4.x ships `tailwind.css` via `node_modules/shadcn/dist/tailwind.css` which `globals.css` imports. Removing it from `dependencies` would break the theme. Leave it. | 2026-05-25 |
| **Disable build script for `msw`** in `pnpm-workspace.yaml` | `msw` is a transitive dep of `shadcn`'s registry tooling, not used at app runtime. Its postinstall sets up a service worker we don't need. | 2026-05-25 |
| Env var naming: **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** (new Supabase convention), not `..._ANON_KEY` | Supabase renamed the public key to "publishable" in late 2025. Using the new name forward — even though our project issued a legacy `anon`-role JWT, the value works in either env var name. | 2026-05-25 |
| Use **`proxy.ts`** (Next.js 16 convention), not `middleware.ts` | Next 16 renamed the middleware file convention to "proxy." `middleware.ts` still works but emits a deprecation warning. Confirmed via Next 16 upgrade docs. **Side effect**: proxy runs in the **Node.js runtime**, not Edge — fine for Supabase session refresh, slightly different perf profile from the old Edge middleware. | 2026-05-25 |
| `@supabase/ssr` cookie pattern: **`getAll` / `setAll`**, not per-cookie `get/set/remove` | The post-0.5 API. Pre-0.5 individual-cookie methods are deprecated. Pattern is identical across `src/lib/supabase/server.ts` and `src/proxy.ts` — the only difference is where the cookies live (request vs. `cookies()`). | 2026-05-25 |
| Fonts: **Instrument Serif** (display, italic) + **Hanken Grotesk** (body) + **JetBrains Mono** (small marks) | Explicit avoidance of Inter/Geist defaults. Serif headlines + warm sans body fit the "calm editorial" direction in `DESIGN.md`. Italic Instrument Serif is the visual hook (the pink "together" word). | 2026-05-25 |
| Style the `Link` with `buttonVariants(...)` instead of `<Button asChild>` | The new shadcn `base-nova` Button (built on `@base-ui/react`) has no Slot/`asChild` prop. The official pattern with this primitive is to apply `buttonVariants` to whatever element you want to look like a button. | 2026-05-25 |
| Landing palette: **OKLCH** tokens, with hand-tuned values matching the `#faf7f5 / #f8c1d4 / #67e8f9 / #374151` palette in `DESIGN.md` | Shadcn's `base-nova` defaults to OKLCH; staying in OKLCH keeps the theming consistent with future shadcn components and gives more perceptually-even hue shifts than hex/HSL. Dark mode tokens are warm-toned (mocha base, not neutral black) so the brand still reads. | 2026-05-25 |
| Build iteratively in small steps | Learning project — cleaner code, easier to debug, validates assumptions early. | 2026-05 |
| Warm & calm visual design | Trip planning should reduce stress, not add to it. | 2026-05 |

## Notes
Append a row whenever a non-obvious choice is made. The "Why" column is the load-bearing one — without it, future-you can't tell whether the decision is still valid.
