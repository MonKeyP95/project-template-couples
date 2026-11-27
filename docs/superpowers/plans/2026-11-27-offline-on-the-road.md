# Offline On the Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app installs on Android, opens `/on-the-road` with no connection, and queues quick expense / note / today-event adds in an on-phone outbox that sends itself when signal returns.

**Architecture:** A hand-written `public/sw.js` stores the `/on-the-road` document (network first) and `/_next/static/*` (cache first), and marks a served stored copy with an injected flag. The three on-the-road forms generate an id on the phone, call their Server Action, and on a thrown (network) failure put the call into a `localStorage` outbox. A flusher on the page sends the outbox only from a page fresh from the network.

**Tech Stack:** Next.js 16 App Router (`app/manifest.ts`, Server Actions), Service Worker + Cache API, `localStorage`, `useSyncExternalStore`, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-27-offline-on-the-road-design.md`

## Global Constraints

- No new dependency. No test runner exists; do not add one. Verification per task is `pnpm lint`, `pnpm exec tsc --noEmit`, and (end of each increment) `pnpm build` -- ask the user to stop `pnpm dev` before building.
- Service worker registers only when `process.env.NODE_ENV === "production"`.
- Server actions stay the only write path; the outbox calls `logExpense`, `addNote`, `addTodayEvent`.
- Dates written by the three forms come from `deviceToday()` (`src/lib/time/today.ts`) at submit time, never the page's `today` prop.
- Only `GET`, non-redirected, `ok` responses are ever stored.
- No emojis; sparse comments; European date order in any shown date.
- Three increments, each its own PR, merged after the user's in-app check: Tasks 1-2, Tasks 3-5, Task 6.

## Review Focus

1. **Lost response, not lost request:** the action reached the server but the reply never arrived -> queued -> resent. Expect one row (id chosen before the first attempt, `23505` -> success). Pinned in Task 3 + Task 5 step "id before first call".
2. **Stored copy from yesterday:** an add writes the phone's date. Pinned in Task 5/6 (`deviceToday()` at submit).
3. **Redirect stored as the offline copy:** `/on-the-road` redirects to `/home` (no trip) or `/signin` (expired). Must never be cached. Pinned in Task 2 (`!res.redirected && res.ok`).
4. **First visit after install has no cached chunks** (worker wasn't active while they loaded). Pinned in Task 2 "warm" message.
5. **Hydration of `useSyncExternalStore` over `localStorage`:** server snapshot `[]`, client snapshot must be referentially stable between reads or React loops. Pinned in Task 4 (cache parsed list by raw string).

---

### Task 1: Installable app (manifest, icons, proxy, headers, sign-out)

**Files:**
- Create: `src/app/manifest.ts`
- Create: `scripts/make-icons.mjs`, outputs `public/icon-192.png`, `public/icon-512.png`
- Modify: `src/proxy.ts:80-82` (matcher)
- Modify: `next.config.ts` (headers)
- Modify: `src/app/api/signout/route.ts`

**Interfaces:**
- Produces: `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/sw.js` reachable without a session; `Cache-Control: no-cache` on `/sw.js`.

- [ ] **Step 1: `src/app/manifest.ts`** -- `export default function manifest(): MetadataRoute.Manifest` with `name: "Together"`, `short_name: "Together"`, `start_url: "/on-the-road"`, `display: "standalone"`, `background_color` / `theme_color` as hex equivalents of the light `--background` and `--sea` tokens in `src/app/globals.css`, icons `/icon-192.png` (192x192) and `/icon-512.png` (512x512), `type: "image/png"`, `purpose: "any"`.
- [ ] **Step 2: icons** -- `scripts/make-icons.mjs` renders a plain sea-coloured square with a serif "T" via `ImageResponse` from `next/og` (React.createElement, no JSX) at 192 and 512, writes the PNGs to `public/`. Run `node scripts/make-icons.mjs`; expect both files present and non-empty.
- [ ] **Step 3: proxy matcher** -- add `manifest.webmanifest|sw.js` to the negative lookahead next to `favicon.ico` (`.png` is already excluded).
- [ ] **Step 4: `next.config.ts`** -- `async headers()` returning, for source `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript; charset=utf-8`.
- [ ] **Step 5: sign-out** -- set header `Clear-Site-Data: "cache", "storage"` on the existing 303 redirect response.
- [ ] **Step 6: verify** -- `pnpm lint` and `pnpm exec tsc --noEmit` clean.
- [ ] **Step 7: commit** -- `feat: installable app manifest and icons`.

### Task 2: Service worker -- `/on-the-road` opens offline

**Files:**
- Create: `public/sw.js`
- Create: `src/components/offline/service-worker.tsx`
- Create: `src/lib/offline/offline-copy.ts`
- Modify: `src/app/layout.tsx` (mount `<ServiceWorker />` inside `<body>`)

**Interfaces:**
- Produces: `isOfflineCopy(): boolean` in `src/lib/offline/offline-copy.ts` -- true when `window.__offlineCopy === 1` (declare the global on `Window`).
- Produces: worker message `{ type: "warm", urls: string[] }`.

- [ ] **Step 1: `public/sw.js`** with:
  - `const VERSION = "v1"`; caches `pages-${VERSION}` and `static-${VERSION}`.
  - `install`: `self.skipWaiting()`. `activate`: delete every cache whose name is not one of the two; `self.clients.claim()`.
  - `fetch`, only `GET` + same origin:
    - navigate to pathname `/on-the-road`: `fetch(request)`; if `res.ok && !res.redirected`, put a clone in `pages` under key `"/on-the-road"`; return `res`. On throw: stored copy -> return it marked (below); none -> offline page.
    - other navigate: `fetch(request)`, on throw -> offline page.
    - pathname starts with `/_next/static/`: cache first, store on miss.
    - anything else: no `respondWith`.
  - Marking: read the stored copy's text, replace `</head>` with `<script>self.__offlineCopy=1</script></head>`, return a new `Response` with the stored headers.
  - Offline page: a small inline-styled HTML `Response` (status 503): "No connection." / "The on-the-road screen works offline." with a link to `/on-the-road`.
  - `message` `{ type: "warm", urls }`: `caches.open(static).addAll(urls)` for urls under `/_next/static/`, and fetch-and-store `/on-the-road` into `pages` (same `ok && !redirected` rule). Use `event.waitUntil`.
- [ ] **Step 2: `ServiceWorker` client component** -- returns `null`; in `useEffect`, if production and `"serviceWorker" in navigator`: `register("/sw.js")`; then, when `location.pathname === "/on-the-road"` and `!isOfflineCopy()`, after `navigator.serviceWorker.ready` post `warm` with the `/_next/static/` URLs from `performance.getEntriesByType("resource")`.
- [ ] **Step 3: mount** in `src/app/layout.tsx`.
- [ ] **Step 4: verify** -- lint + tsc clean; ask the user to stop dev, `pnpm build` passes; `pnpm start` then `curl -sI http://localhost:3000/sw.js` shows `200` and `Cache-Control: no-cache...`; `curl -sI http://localhost:3000/manifest.webmanifest` shows `200` (no 307 to `/signin`). Stop `pnpm start`.
- [ ] **Step 5: commit** -- `feat: service worker keeps on-the-road offline`.
- [ ] **Step 6: increment 1 PR.** Update `docs/TODO.md` (implemented, unverified, in-app checks 1-3, 8-10 from the spec) and add a `docs/DECISIONS.md` row (hand-written worker over Serwist; network-first on-the-road only). Push, PR via `--body-file`, `gh pr checks` alone. User tests the preview (offline open in a Chrome tab), install after merge on prod.

### Task 3: Server actions accept a phone id; events dedupe

**Files:**
- Modify: `src/lib/trips/actions.ts` (`LogExpenseInput` ~223, `logExpense` ~284, `AddNoteInput` ~1391, `addNote` ~1414, `addTodayEvent` ~1772)

**Interfaces:**
- Produces: `LogExpenseInput.id?: string`, `AddNoteInput.id?: string`. With `id`, `logExpense` returns `{ expenseId: id }` and `addNote` returns `{}` when the insert fails with code `23505`.
- Produces: `addTodayEvent` leaves `events` unchanged (and returns `{}`) when an event with the same `time` and `text` is already on that day, in all three write branches.

- [ ] **Step 1:** pass `id: input.id` into both inserts (omit the key when undefined); map `error.code === "23505" && input.id` to success as above.
- [ ] **Step 2:** private helper `withEventOnce(existing: ItineraryEvent[], e: ItineraryEvent): ItineraryEvent[] | null` (null = already there); use it in the `dayId` branch and the `23505` append branch, skipping the update on null.
- [ ] **Step 3: verify** -- lint + tsc clean. Reason through: second `logExpense` with the same id -> insert `23505` -> `{ expenseId: id }`, one row.
- [ ] **Step 4: commit** -- `feat: adds accept a phone id and skip repeats`.

### Task 4: Outbox (store, send, flush, pending list)

**Files:**
- Create: `src/lib/offline/outbox.ts`
- Create: `src/lib/offline/send.ts`
- Create: `src/components/offline/pending-list.tsx`
- Create: `src/components/offline/outbox-flusher.tsx`
- Modify: `src/app/on-the-road/page.tsx` (mount `<OutboxFlusher />` once)

**Interfaces:**
- Consumes: `isOfflineCopy()` (Task 2); inputs from Task 3.
- Produces (`outbox.ts`, key `"together-outbox"`):
  ```ts
  type Base = { id: string; queuedAt: string; failed?: string }
  export type OutboxItem =
    | (Base & { kind: "expense"; input: LogExpenseInput })
    | (Base & { kind: "note"; input: AddNoteInput })
    | (Base & { kind: "event"; input: AddTodayEventInput })
  export function readOutbox(): OutboxItem[]          // stable ref while raw string unchanged
  export function enqueue(item: OutboxItem): void
  export function removeItem(id: string): void
  export function markFailed(id: string, message: string): void
  export function useOutbox(kind: OutboxItem["kind"]): OutboxItem[]
  ```
  Writes dispatch a `"together-outbox"` window event; `useOutbox` is `useSyncExternalStore(subscribe, readOutbox, () => EMPTY)` filtered by kind (memoised).
- Produces (`send.ts`):
  ```ts
  export function sendItem(item: OutboxItem): Promise<{ error?: string }>
  export function submitOrQueue(item: OutboxItem): Promise<{ error?: string; queued?: boolean }>
  export function flushOutbox(): Promise<number>   // count sent
  ```
  `submitOrQueue`: `await sendItem`; a throw -> `enqueue(item)`, `{ queued: true }`. `flushOutbox`: every item in order; success -> remove; `{ error }` -> `markFailed(id, error)`; throw -> `markFailed(id, "send failed")`, continue.
- Produces: `<PendingList kind label={(item) => string} />` -- nothing when empty; else "waiting to send · N" and one muted line per item with its `failed` text in clay, a "retry" button (`sendItem`, then remove or `markFailed`, then `router.refresh()`), and a "remove" button.
- Produces: `<OutboxFlusher />` -- `null`; on mount: if `isOfflineCopy()`, on `online` -> `location.reload()`; else `flushOutbox()` now and on every `online`, `router.refresh()` when it returns > 0.

- [ ] **Step 1:** write `outbox.ts`; **Step 2:** `send.ts`; **Step 3:** `pending-list.tsx`; **Step 4:** `outbox-flusher.tsx` + mount.
- [ ] **Step 5: verify** -- lint + tsc clean.
- [ ] **Step 6: commit** -- `feat: on-phone outbox for on-the-road adds`.

### Task 5: Quick expense uses the outbox

**Files:**
- Modify: `src/app/on-the-road/quick-expense.tsx`

**Interfaces:**
- Consumes: `submitOrQueue`, `PendingList` (Task 4), `deviceToday()`.

- [ ] **Step 1: id before first call** -- in `submit`, build `{ kind: "expense", id: crypto.randomUUID(), queuedAt: new Date().toISOString(), input: { ...today's fields, id, dayDate: deviceToday() } }` and call `submitOrQueue`.
- [ ] **Step 2:** `{ error }` -> show as today. `queued` -> clear the form, `onSaved?.()`, no refresh, receipt not attached (set `receiptId` null). Success -> attach receipt with `item.id` as the expense id, as today.
- [ ] **Step 3:** render `<PendingList kind="expense" label={(i) => `${i.input.title} · ${i.input.amount} ${i.input.currency}`} />` under the form.
- [ ] **Step 4: verify** -- lint + tsc clean; ask to stop dev; `pnpm build` passes.
- [ ] **Step 5: commit** -- `feat: quick expense queues offline`.
- [ ] **Step 6: increment 2 PR** -- TODO.md entry (checks 4, 5b, 6, 7 for expenses), push, PR, `gh pr checks`.

### Task 6: Quick note and today event use the outbox

**Files:**
- Modify: `src/app/on-the-road/quick-note.tsx`
- Modify: `src/app/on-the-road/add-today-event.tsx`

- [ ] **Step 1: note** -- same pattern as Task 5: id before first call, `dayDate: deviceToday()`, queued -> clear like success without refresh; `<PendingList kind="note" label={(i) => i.input.body} />` under the form.
- [ ] **Step 2: event** -- input `{ ..., dayDate: deviceToday(), dayId: null }` always (the date path appends to the existing day via its `23505` branch); queued -> clear and close like success; `<PendingList kind="event" label={(i) => `${i.input.time} ${i.input.text}`.trim()} />` rendered outside the open/closed switch so it shows while closed. The `dayId` prop becomes unused -- remove it here and at `road-cards.tsx:194`.
- [ ] **Step 3: verify** -- lint + tsc clean; ask to stop dev; `pnpm build` passes.
- [ ] **Step 4: commit** -- `feat: quick note and event queue offline`.
- [ ] **Step 5: increment 3 PR** -- TODO.md (checks 5, 6, 7 for notes/events), push, PR, `gh pr checks`.
