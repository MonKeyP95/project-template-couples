# Offline on the road — design

Date: 2026-11-27. Status: draft, awaiting approval.

## Intent

On a trip, signal sometimes disappears completely (surfing remote spots). Today
the app then neither opens nor saves: every screen is rendered on the server
and every add is a Server Action. Goal: on an Android phone with **no
connection at all**, the user can **open the app from cold** on the
on-the-road screen and **add an expense, a note, or an event for today**. The
adds are sent automatically once signal returns. It happens less and less, so
the build should stay small.

## Goals

- The app installs to the Android home screen ("Install app" in Chrome).
- Opening `/on-the-road` with no connection shows the last copy seen online
  (read-only for everything except the three adds).
- The three on-the-road add forms -- quick expense (`quick-expense.tsx`),
  quick note (`quick-note.tsx`), add today event (`add-today-event.tsx`) --
  save to an on-phone outbox when the server can't be reached.
- Waiting items are visible ("waiting to send") under the form that made them.
- The outbox sends itself when the app is open and online again, then the page
  refreshes; a retry never creates a duplicate.

## Non-goals

- Offline for the trip page (`/trips/[slug]`), home, profile, or any other
  screen. Navigating there offline shows the browser's/our offline message.
- Offline edits, deletes, drag-and-drop. Adds only -- adds never collide.
- Receipt photos, AI assistant, find-a-place, weather/news refresh offline.
- Sending while the app is closed (Android Background Sync) -- production later.
- iPhone-specific handling (users are on Android); it should not break iPhone.
- Pending items counted in totals/cards before they are sent.

## Anti-goals

- An add the user saw "saved / waiting" silently disappears.
- The same expense saved twice after a flaky reconnect.
- A deploy leaves phones stuck on an old stored screen while online.
- A signed-out phone still holds the trip's stored screen or outbox.
- Breaking `pnpm dev` (Turbopack) with a service worker.

## Constraints

- Next.js 16 App Router, Server Actions, Turbopack; deploy on Vercel.
- The service worker only runs in production; testing is on the Vercel deploy.
- Server actions stay the single write path (`logExpense`, `addNote`,
  `addTodayEvent` in `src/lib/trips/actions.ts`); the outbox calls them, it
  does not write to Supabase directly.
- Existing rules: no new library without reason, no defensive code, short
  modules, migrations re-runnable and pasted by hand.

## Approaches considered

- **A. Hand-written service worker + web manifest (chosen).** Follows Next.js's
  own PWA guide: `app/manifest.ts` plus one small `public/sw.js` we own. No
  dependency, no bundler coupling, enough for one cached screen.
- **B. Serwist (`@serwist/next`).** The usual library; precaching and caching
  recipes. Built around webpack, Turbopack support uncertain, and more
  machinery than one screen needs. Rejected.
- Not considered further: making the trip page offline too (many forms, edits
  that can collide) -- user chose on-the-road only.

## The design (decided)

### 1. Installable + opens offline (read-only)

- `src/app/manifest.ts`: name "Together", `start_url: "/on-the-road"`,
  `display: "standalone"`, theme/background colors from the DESIGN palette,
  192 and 512 PNG icons.
- `public/sw.js`, registered by a small client component in the root layout,
  **production only** (`process.env.NODE_ENV === "production"`).
- Caching:
  - Navigation to `/on-the-road`: **network first**, store the response, fall
    back to the stored copy when the network fails.
  - `/_next/static/*` (hashed, immutable): **cache first**, stored on first
    fetch. This keeps the JS/CSS the stored page needs.
  - Any other navigation that fails offline: a minimal offline response saying
    "No connection -- the on-the-road screen works offline" with a link to it.
  - Everything else: untouched (straight to network).
- A `VERSION` constant in `sw.js` names the caches; on activate, caches of
  other versions are deleted. `sw.js` is served with `Cache-Control: no-cache`
  (Next headers config) so phones pick up a new worker on the next online open.
- `src/proxy.ts` must let `/manifest.webmanifest` and `/sw.js` through
  without a session (add them to the matcher exclusion). Chrome fetches the
  manifest without cookies, so today the proxy would redirect it to `/signin`
  and install would fail.
- Only `GET` responses that are not redirects are stored (a redirect to
  `/signin` or `/home` must never become the offline copy).

### 2. Expense outbox

- Outbox stored in `localStorage` (small, synchronous, persistent on Android;
  only the page reads it -- the worker never needs it). One key, a list of
  `{ kind: "expense" | "note" | "event", id, input, queuedAt }`.
- Each add gets its **id on the phone** (`crypto.randomUUID()`) before sending.
- Send path: the form calls the server action as today. If the call **throws**
  (network failure -- not an `{ error }` result), the item goes to the outbox
  and the form clears as on success. `navigator.onLine` is not trusted (it
  reports "online" on a dead connection), so failure of the real call is the
  signal. A returned `{ error }` (validation, RLS) keeps today's inline error.
- `logExpense` accepts an optional `id` and inserts with it. A duplicate-key
  error (`23505`) on that id is treated as success (it already landed).
- **Date of an offline add (my call):** the phone's own current date, not the
  stored page's `today`. A copy stored last night and opened offline this
  morning must write this morning's date. The forms take the date at submit
  time (in the trip's time zone, as the page does). Events in the outbox
  therefore never carry a stored `dayId`; they go through `addTodayEvent`'s
  date path, which finds or creates the day for that date. If the phone's date
  is past the trip's end, the add still saves with that date (rare; the trip
  page can move it).
- Flush runs only on a page **freshly loaded from the network** (my call), so
  it always calls the current deploy's Server Actions. A stored page that
  sees the `online` event reloads itself (`location.reload()`); the fresh page
  flushes on load. This avoids "Failed to find Server Action" from an old
  stored build.
- Flush sends items in order; removes each on success; on `{ error }` keeps
  it and shows the error on that pending item with a remove button. On a
  throw during flush: since the page itself just came from the network, the
  connection is up, so a throw is a server failure -- the item shows "send
  failed" with retry and remove buttons, and the flush moves on. Nothing is
  dropped without the user pressing remove. After any success,
  `router.refresh()`.
- Outbox `input` is exactly the server action's input type; a deploy that
  changes an action's input must keep accepting the old shape (or ship
  while outboxes are empty -- for two users, the latter).
- Currency: an offline foreign-currency expense is converted at send time
  (`resolveHomeAmount` runs then). Daily rates; acceptable.
- Receipt camera: unchanged; offline it fails with its existing error.

### 3. Notes and today's events

- `addNote` gets the same optional `id` + `23505`-is-success treatment.
- `addTodayEvent`: events live in the `itinerary_days.events` jsonb array with
  no id. Duplicate guard: skip the append when the day already holds an event
  with the same `time` and `text`. (Re-adding an identical event on purpose is
  not a real case.)
- Both forms use the same outbox and pending display as expenses.

### Sign-out

- `/api/signout` responds with `Clear-Site-Data: "cache", "storage"`, which
  clears the stored screen, the outbox and the worker in one header. A
  non-empty outbox at sign-out is lost; acceptable (sign-out on the road is
  rare). The builder may add a confirm if the outbox is non-empty.
- Only the explicit sign-out button clears the phone (my call). An expired
  session leaves the stored screen on the user's own phone; online, the
  server redirects to `/signin` as today, and redirects are never stored.

### Pending display

- Under each of the three forms: a small "waiting to send · N" list of that
  kind's items (title/amount, note body, event time+text), muted, each with a
  remove button. Disappears when empty.

## Left to the builder

- Icon artwork and how it's produced (static PNGs or `app/icon.tsx` via
  `ImageResponse`).
- Offline fallback page markup.
- Module layout of the outbox (e.g. `src/lib/offline/outbox.ts` + a hook).
- Exact pending-list styling within DESIGN.md.
- Plan split: three increments matching sections 1-3, each deployable and
  testable on Vercel before the next.

## Success criteria

Verified by Claude:
- `pnpm lint`, `tsc`, `pnpm build` pass after each increment.
- `pnpm dev` does not register a service worker.
- The built output serves `/manifest.webmanifest` and `/sw.js` (with
  `Cache-Control: no-cache`), both reachable with no session cookie (no
  redirect to `/signin`).
- `logExpense` / `addNote` with a repeated `id` return success and insert one
  row (reasoned from the code path: insert with id, `23505` -> success).
- `addTodayEvent` called twice with the same time+text leaves one event.
- `/api/signout` response carries `Clear-Site-Data`.

Verified by the user in-app (Android, on the Vercel deploy):
1. Chrome offers "Install app"; the installed icon opens on the on-the-road screen.
2. Open on-the-road online once, then airplane mode, close the app fully, reopen:
   the screen shows (stale data is fine).
3. Offline, open home or a trip page: the offline message with a link back.
4. Offline, add an expense in EUR: the form clears; it shows under "waiting to send".
5. Same for a note and a today event.
5b. Open the stored copy offline the morning after it was saved: an expense
   added then lands on today's date, not yesterday's.
6. Turn signal back on with the app open: items send, the waiting list empties,
   they appear in the cards; the EUR expense has a DKK amount.
7. Flaky case: add offline, reconnect, immediately lose signal again, reconnect:
   each item appears exactly once.
8. After a new deploy, opening online shows the new version (no stuck old copy).
9. Sign out, go offline, open the app: no stored trip screen.
10. `pnpm dev` locally still works as before.
