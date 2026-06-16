# Local "today" via device timezone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UTC-derived "today" everywhere with the device's local date, so trip bucketing, during-trip mode, the home today signal, on-the-road, and stamped expense/settlement dates are correct at positive-offset destinations.

**Architecture:** A `"use client"` component writes the device IANA timezone to a `tz` cookie and refreshes once. A server helper reads that cookie and computes the date with built-in `Intl`. All server "today" sites switch to `await localToday()`; the one client default uses `deviceToday()`.

**Tech Stack:** Next.js 16 App Router (async Server Components / Server Actions, `next/headers` `cookies()`), React 19, built-in `Intl.DateTimeFormat`. No new dependencies, no schema.

**Note on verification:** This repo has no test framework (per CLAUDE.md, do not invent a test command). Each task is verified with `pnpm lint` + `pnpm build` and, where stated, a manual in-app check — matching the established workflow.

**Spec:** `docs/superpowers/specs/2026-06-16-local-today-timezone-design.md`

---

### Task 1: Pure date helper

A dependency-free module both server and client can import (no `next/headers`, per the client/types split rule).

**Files:**
- Create: `src/lib/time/today.ts`

- [ ] **Step 1: Write the helper**

```ts
export const TZ_COOKIE = "tz"

/** "yyyy-mm-dd" for `now` rendered in the given IANA timezone. */
export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Device-local today, for use in client components. */
export function deviceToday(): string {
  return todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/time/today.ts
git commit -m "feat(time): pure device-timezone date helper"
```

---

### Task 2: Server `localToday()` helper

Reads the `tz` cookie and computes the local date; falls back to `"UTC"` (reproduces today's behavior) when the cookie is absent.

**Files:**
- Create: `src/lib/time/local-today.ts`

- [ ] **Step 1: Write the helper**

```ts
import { cookies } from "next/headers"

import { TZ_COOKIE, todayInTimeZone } from "./today"

/** Device-local "today" (yyyy-mm-dd), read from the tz cookie. */
export async function localToday(): Promise<string> {
  const tz = (await cookies()).get(TZ_COOKIE)?.value || "UTC"
  return todayInTimeZone(tz)
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/time/local-today.ts
git commit -m "feat(time): server localToday() from tz cookie"
```

---

### Task 3: TimezoneCookie client component + mount

Writes the device zone to the `tz` cookie on mount; if it was missing or changed, refreshes so server components re-render with the right date.

**Files:**
- Create: `src/components/timezone-cookie.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { TZ_COOKIE } from "@/lib/time/today"

/** Stores the device IANA timezone in a cookie so server components can
 * compute the local date. Refreshes once when the value first appears or
 * changes (e.g. after travelling). Renders nothing. */
export function TimezoneCookie() {
  const router = useRouter()
  React.useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1)
    if (current === tz) return
    document.cookie = `${TZ_COOKIE}=${tz}; path=/; max-age=31536000; SameSite=Lax`
    router.refresh()
  }, [router])
  return null
}
```

- [ ] **Step 2: Mount it in the root layout**

In `src/app/layout.tsx`, add the import after the existing `@/lib/theme` import:

```tsx
import { TimezoneCookie } from "@/components/timezone-cookie"
```

Then render it as the first child inside `<body>`, before `WorldMapBg`:

```tsx
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <TimezoneCookie />
        <WorldMapBg className="fixed inset-0 -z-10 text-foreground/[0.07]" />
        {children}
      </body>
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/timezone-cookie.tsx src/app/layout.tsx
git commit -m "feat(time): set tz cookie from device, refresh on change"
```

---

### Task 4: Switch server call-sites to `localToday()`

Five server reads of the UTC date become `await localToday()`.

**Files:**
- Modify: `src/lib/trips/list-queries.ts:83`
- Modify: `src/app/home/page.tsx:79-82`
- Modify: `src/app/on-the-road/page.tsx:47`
- Modify: `src/app/trips/[slug]/page.tsx:236`
- Modify: `src/lib/trips/actions.ts:297` (+ its two awaited uses)

- [ ] **Step 1: `list-queries.ts`**

Add the import near the other `@/lib/...` imports at the top of the file:

```ts
import { localToday } from "@/lib/time/local-today"
```

Replace line 83:

```ts
  const today = new Date().toISOString().slice(0, 10)
```

with:

```ts
  const today = await localToday()
```

- [ ] **Step 2: `home/page.tsx`**

Add the import near the other `@/lib/...` imports:

```ts
import { localToday } from "@/lib/time/local-today"
```

Replace the `heroToday` block (lines 79-82):

```tsx
  const heroToday =
    hero && hero.state === "now"
      ? await getTodayForTrip(hero.id, new Date().toISOString().slice(0, 10))
      : null
```

with:

```tsx
  const heroToday =
    hero && hero.state === "now"
      ? await getTodayForTrip(hero.id, await localToday())
      : null
```

- [ ] **Step 3: `on-the-road/page.tsx`**

Add the import near the other `@/lib/...` imports:

```ts
import { localToday } from "@/lib/time/local-today"
```

Replace line 47:

```ts
  const today = new Date().toISOString().slice(0, 10)
```

with:

```ts
  const today = await localToday()
```

- [ ] **Step 4: `trips/[slug]/page.tsx`**

Add the import near the other `@/lib/...` imports:

```ts
import { localToday } from "@/lib/time/local-today"
```

This is an async Server Component. Compute the date once before the
returned JSX (place it next to the other top-level `const`s in the
component body, e.g. just after the data is fetched):

```ts
  const today = await localToday()
```

Then replace line 236:

```tsx
              today={new Date().toISOString().slice(0, 10)}
```

with:

```tsx
              today={today}
```

- [ ] **Step 5: `actions.ts`**

Add the import near the other `@/lib/...` imports at the top:

```ts
import { localToday } from "@/lib/time/local-today"
```

Replace the `TODAY` definition at line 297:

```ts
const TODAY = () => new Date().toISOString().slice(0, 10)
```

with:

```ts
const TODAY = () => localToday()
```

Both call-sites (the two settlement inserts, currently `day_date: TODAY(),`)
are inside `async` server actions, so make each `await`:

```ts
    day_date: await TODAY(),
```

(Apply to both occurrences — around lines 327 and 371.)

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. (Confirm no "missing await" or type errors from `TODAY()` now returning a Promise.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/list-queries.ts src/app/home/page.tsx src/app/on-the-road/page.tsx "src/app/trips/[slug]/page.tsx" src/lib/trips/actions.ts
git commit -m "fix(time): server today reads device tz, not UTC"
```

---

### Task 5: Fix the client expense-default date

The new-expense default is computed client-side but still via UTC; switch it to `deviceToday()`.

**Files:**
- Modify: `src/app/trips/[slug]/log-expense-row.tsx:24-26`

- [ ] **Step 1: Replace the local `todayIso` helper**

Add the import near the top imports:

```ts
import { deviceToday } from "@/lib/time/today"
```

Delete the local helper (lines 24-26):

```ts
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
```

Find its single call inside the component (the default-date initializer,
`todayIso()`) and replace it with `deviceToday()`.

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS, no "todayIso is not defined".

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/log-expense-row.tsx"
git commit -m "fix(time): new-expense default uses device-local date"
```

---

### Task 6: Manual verification + docs

- [ ] **Step 1: Manual check (device-tz override)**

Run `pnpm dev`. In the browser, sign in and open `/home` and a trip.
In devtools Application > Cookies, set `tz` to a far-east zone (e.g.
`Asia/Makassar`) and reload. Confirm:
- The home today signal / on-the-road header show the local date.
- During-trip itinerary emphasis keys off the local date.
- Logging an expense pre-fills today's local date.
Then delete the `tz` cookie and reload: the page renders (UTC fallback)
and the cookie is re-set by `TimezoneCookie`, after which a second render
shows the device date.

- [ ] **Step 2: Update `docs/TODO.md`**

Add a shipped entry near the top of `docs/TODO.md` (above the most recent
dated entry) and remove the now-resolved carried bullet:

```markdown
**Local "today" via device timezone: shipped 2026-06-16.** Replaced UTC-derived `today` (`new Date().toISOString().slice(0,10)`) across trip bucketing (`list-queries.ts`), during-trip itinerary mode (`page.tsx`), the home today signal (`home/page.tsx`), on-the-road (`on-the-road/page.tsx`), and stamped settlement/expense dates (`actions.ts`, `log-expense-row.tsx`). A `TimezoneCookie` client component (mounted in the root layout) writes the device IANA zone to a `tz` cookie and `router.refresh()`es on change; server `localToday()` (`src/lib/time/local-today.ts`) reads it and computes the date via `Intl`, falling back to UTC for the single cold-load render. Pure `todayInTimeZone`/`deviceToday` live in `src/lib/time/today.ts`. No schema, no deps. Resolves the carried "today is UTC-derived" item. Spec/plan under `docs/superpowers/`.
```

Delete the carried bullet in the Phase 4.6 section that begins
`**"Today" for during-trip mode is UTC-derived**`.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md
git commit -m "docs(todo): log local-today timezone fix"
```

---

## Self-Review

**Spec coverage:**
- Pure helper (`todayInTimeZone`/`deviceToday`/`TZ_COOKIE`) → Task 1.
- Server `localToday()` with UTC fallback → Task 2.
- `TimezoneCookie` component + layout mount + refresh-on-change → Task 3.
- All five server call-sites swapped → Task 4.
- Client expense default → Task 5.
- Fallback/first-render behavior exercised + docs → Task 6.
All spec sections map to a task.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code.

**Type consistency:** `TZ_COOKIE`, `todayInTimeZone(tz, now?)`, `deviceToday()`, `localToday()` are named identically wherever referenced across Tasks 1-5. `TODAY()` returns a Promise after Task 4 and every call-site awaits it.
