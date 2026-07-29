# One-screen join

**Date:** 2026-07-29
**Status:** designed, not implemented

## Why

Two real failures on the first live pairing attempt, both in the invite flow:

1. **A pointless hop.** `/join/[token]` showed "You've been invited" plus a
   *Sign up* button that led to `/signup?invite=…` — a second page asking for
   the details the first page could have asked for.
2. **A dead end.** The invitee had already made an account, which the signup
   trigger had handed its own workspace. `accept_invite` refuses anyone who is
   already in a workspace, so the invite could never be accepted. It took
   manual SQL to clear.

Both are fixed at the entry point: the link resolves everything itself.

## What is being built

- `/join/[token]` becomes one screen: the invitation and the signup fields
  together, with a single **Join** button.
- `accept_invite` handles the collision instead of refusing: if the invitee's
  own workspace holds nothing, they leave it silently and join. If it holds
  real data, they get an explanation rather than a wall.

**There is no "leave workspace" button.** Leaving happens inside the join, only
when there is nothing to lose, and never appears in the UI. A general leave
action was considered and dropped: it needs guards for owners and for
workspaces with data, and nothing in the app asks for it.

Removing workspace auto-creation at signup — the true root cause — was also
considered and rejected: `getCurrentWorkspace` has 50 call sites across 21
files, all assuming a workspace exists. Too large a change for a two-person app.

## 1. The join screen

`src/app/join/[token]/page.tsx`, unauthenticated + valid token. Replaces the
two-button card:

```
You've been invited to join <workspace name>.

Name      [                    ]
Email     [                    ]
Password  [                    ]

[ Join ]

Already have an account? Sign in
```

- The form is the existing `SignUpForm` with `invite={token}`, so the token
  still travels as a hidden field into `signUp` and on into the trigger. No new
  auth path.
- `SignUpForm` gains one optional prop, `submitLabel?: string`, defaulting to
  its current `"create account"`. The join screen passes `"join"`.
- **Sign in stays**, as a small text link to `/signin?invite=<token>` — not a
  button. Someone who already has an account is exactly the case that failed
  live; removing that route would strand them.
- **Name stays on the form.** Without it `handle_new_user` falls back to
  `split_part(email, '@', 1)`, so the partner shows up as "johnsmith92" on trip
  cards and expense splits.
- `/signup?invite=<token>` keeps working unchanged — it is still the target of
  the "create an account" link on `/signin`.

## 2. `accept_invite` resolves the collision

`supabase/migrations/<timestamp>_accept_invite_leaves_empty_workspace.sql`,
a `create or replace` of the existing function (idempotent, re-pasteable).

Current behaviour raises `You are already in a workspace` whenever the caller
has any membership. New behaviour, in order:

1. **Already in the invited workspace** → return its id. Success, not an error.
   Makes a double-click or a re-opened link harmless.
2. **In a workspace that is empty** → delete their membership, then delete that
   workspace, then join as before. Empty means, for that workspace: no other
   members, no `trips` rows, and no `checklists` rows.
3. **In a workspace with data** → raise
   `Your workspace has trips in it. Ask the person who invited you to join yours instead.`
4. **In no workspace** → unchanged.

The workspace delete is guarded by the same emptiness test, so it cannot
destroy data even if the membership delete and the check ever disagreed.
Deleting an empty workspace cascades only to its own `invites` rows.

## 3. What the signed-in join page shows

`/join/[token]` with a session calls `acceptInvite` and, on error, prints the
message. With the above, the four outcomes are:

| Invitee state | Result |
|---|---|
| No workspace | Joins |
| Empty workspace | Leaves it, joins |
| Already in this workspace | Lands on `/home` |
| Workspace with trips | Explained, with what to do instead |

## Deliberately not doing

- No leave-workspace button, in settings or anywhere else.
- No change to workspace auto-creation at signup.
- No merging of two populated workspaces. The fourth row above is a message,
  not a migration tool.

## Success criteria

### Verified by Claude

1. `pnpm lint` and `pnpm exec tsc --noEmit` are clean.
2. `/join/[token]` renders no link to `/signup` for an unauthenticated visitor —
   the fields are on the page itself.
3. `SignUpForm` with no `submitLabel` still renders `create account`, so
   `/signup` is visually unchanged.
4. The migration is re-runnable: it is `create or replace function` plus a
   `grant`, with no `drop`.
5. The new `accept_invite` returns the workspace id, not an exception, when the
   caller is already a member of the invited workspace.
6. The workspace delete in `accept_invite` is conditional on zero trips and zero
   checklists, verifiable by reading the function body.

### Verified by the user in-app

1. Opening a fresh invite link while signed out shows one screen with Name,
   Email, Password and a **Join** button — no intermediate page.
2. Filling it in lands you inside the inviter's workspace, with your name (not
   your email prefix) shown as a member.
3. The "Already have an account? Sign in" link signs you in and drops you into
   the workspace.
4. Signing up normally at `/signup`, then opening an invite link, now joins
   instead of erroring — and the abandoned workspace is gone from the database.
5. Creating a trip in your own workspace, then opening an invite link, shows the
   explanation message and leaves your trip untouched.
6. Opening an invite link you have already accepted lands you on `/home`.
7. `/signup` on its own still works and still says "create account".
