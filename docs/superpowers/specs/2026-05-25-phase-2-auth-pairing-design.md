# Phase 2 — Auth + Pairing (Design Spec)

**Date**: 2026-05-25
**Status**: Approved, awaiting implementation plan
**Scope**: Sign-up, sign-in, sign-out, profile, shared workspace, partner invite/join — the full Phase 2 sub-list from `docs/TODO.md`.
**Out of scope**: see "Out of scope" at the bottom.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Email + password** auth (not magic link, not OAuth) | Most complete auth flow to learn. No extra email-provider setup. |
| 2 | **Shareable invite link** for pairing (not email invite, not invite code) | Works over any channel (iMessage/WhatsApp/AirDrop). Production-pattern. |
| 3 | **One workspace per user** at the UI level | Schema supports many (workspaces + workspace_members from day one), UI hides the multiplicity. Switcher when actually needed. |
| 4 | **Email confirmation off** in Supabase | Two-people-we-trust MVP. Flip before any public exposure; add password reset at the same time. |

## Data Model

Four tables, two Postgres functions, RLS on everything.

### Tables

```sql
profiles
  id uuid PK references auth.users(id) on delete cascade
  display_name text not null check (length(trim(display_name)) > 0)
  created_at timestamptz default now()

workspaces
  id uuid PK default gen_random_uuid()
  name text not null default 'Our trips'
  created_by uuid not null references auth.users(id)
  created_at timestamptz default now()

workspace_members
  workspace_id uuid references workspaces(id) on delete cascade
  user_id uuid references auth.users(id) on delete cascade
  role text not null check (role in ('owner', 'member'))
  joined_at timestamptz default now()
  PRIMARY KEY (workspace_id, user_id)

invites
  id uuid PK default gen_random_uuid()
  workspace_id uuid not null references workspaces(id) on delete cascade
  token text not null unique  -- 32-char url-safe random
  expires_at timestamptz not null  -- now() + interval '14 days'
  used_at timestamptz  -- null until consumed
  created_by uuid not null references auth.users(id)
  created_at timestamptz default now()
```

### Functions (all `SECURITY DEFINER`, `search_path = public`)

**`handle_new_user()`** — trigger on `auth.users INSERT`:
- Reads `raw_user_meta_data` for `display_name` (required) and optional `invite_token`.
- Always inserts the profile row.
- If `invite_token` is valid (exists, not used, not expired): inserts into `workspace_members` as `'member'`, marks invite `used_at = now()`. **Does not** create a personal workspace.
- Else: creates a new workspace, inserts the user as `'owner'`.

**`accept_invite(p_token text) → uuid`** — RPC for already-authenticated users:
- Refuses if `auth.uid()` is already in any `workspace_members` row → raises `'You are already in a workspace'`.
- Otherwise validates token (exists, not used, not expired) → inserts membership → marks invite used → returns the joined workspace's id.

**`get_invite_preview(p_token text) → table(workspace_name text, valid boolean)`** — readable by *unauthenticated* callers:
- Looks up the invite by token. Returns the workspace name plus a `valid` flag (`true` only if `used_at is null and expires_at > now()`).
- This is the **only** unauthenticated read path into the system. It exists so `/join/[token]` can render "You've been invited to join `[workspace name]`" before the visitor signs in. It deliberately exposes only the workspace's display name — not member list, not trip data.

### RLS

Enabled on all four tables. Policies routed through a helper to avoid policy-on-self recursion:

```sql
is_workspace_member(workspace_id uuid) returns boolean
  -- SECURITY DEFINER, STABLE
  -- SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = auth.uid())

is_workspace_owner(workspace_id uuid) returns boolean
  -- same, plus AND role = 'owner'
```

Policies (summary):

| Table | Read | Write |
|---|---|---|
| `profiles` | `to authenticated using (true)` | `UPDATE` self only: `using (id = auth.uid())` |
| `workspaces` | `using (is_workspace_member(id))` | `UPDATE` by owner: `using (is_workspace_owner(id))` |
| `workspace_members` | `using (is_workspace_member(workspace_id))` | `DELETE` self-or-owner |
| `invites` | `using (is_workspace_member(workspace_id))` | `INSERT` by owner only: `with check (is_workspace_owner(workspace_id))` |

Inserts into `profiles`, `workspaces`, `workspace_members` from sign-up flow happen *inside* `handle_new_user()` (security definer) and *inside* `accept_invite()`. App-code paths only ever `INSERT` into `invites` directly. Everything else either goes through a function or is read-only.

## Routes & Auth Flow

### Routes

| Path | Auth | Purpose |
|---|---|---|
| `/` | Public | Existing landing |
| `/signin` | Public (redirects to `/home` if already authed) | Email + password sign-in |
| `/signup` | Public (same redirect) | Sign-up, optionally with `?invite=<token>` |
| `/join/[token]` | Public | Invite-acceptance dispatcher |
| `/home` | Protected | Placeholder dashboard |
| `/profile` | Protected | Edit display name |
| `POST /api/signout` | Protected | Calls `supabase.auth.signOut()`, redirects to `/` |

### Proxy logic (additions to `src/proxy.ts`)

After the session refresh:
- Authenticated user hitting `/signin` or `/signup` → redirect to `/home`.
- Unauthenticated user hitting a protected route → redirect to `/signin?next=<original>`.
- Public list and protected list are explicit arrays in `proxy.ts`. No glob-matching cleverness.

### `/join/[token]` dispatch

- Server Component calls the `get_invite_preview(p_token)` function to fetch the workspace name and a `valid` flag. This is the *one* unauthenticated-read entry point into the system; see Data Model > Functions.
- Not signed in + valid token: render a card with workspace name and two buttons ("Sign up", "Sign in"). Both routes carry `?invite=<token>` forward.
- Signed in + valid token: call `accept_invite(token)` via RPC. On success → `/home`. On "already in a workspace" → friendly inline error with no retry.
- Invalid/expired: friendly error page with link to `/`.

### Sign-up form

- Fields: `display_name`, `email`, `password` (Supabase enforces 8-char minimum).
- No confirm-password field.
- If `?invite=<token>` is present, it's added to `options.data` on `signUp()`, which lands in `raw_user_meta_data` and is read by `handle_new_user()`.

## Invite Creation

A card on `/home`, visible only when you're alone in the workspace.

**Server Action `generateInvite()`**:
1. Asserts caller is workspace owner.
2. If an unused + unexpired invite already exists for this workspace → returns its URL.
3. Else: `crypto.randomBytes(24).toString('base64url')` → 32 chars → inserts row with `expires_at = now() + interval '14 days'`.
4. Returns `${origin}/join/${token}`.

**UI**:
- Inviter sees a `<code>` block with the URL, a "Copy" button (`navigator.clipboard.writeText`), and a muted line: *"Expires in 14 days · single use."*
- No QR, no native share sheet, no email. The user sends the link through whatever channel they want.

## Page Sketches

All pages inherit `docs/DESIGN.md`: warm palette, Instrument Serif for headlines, Hanken Grotesk for body, generous whitespace, mobile-first.

- **`/signin`** — Centered card. Headline *"Welcome back."* Email + password fields. Primary button "Sign in." Below: small text "New here? *Create an account.*" Inline error under the form on failure.
- **`/signup`** — Same shell. Headline *"Make space for two."* Three fields. If `?invite=<token>` present, an extra muted line above: *"You're joining `[workspace name]`. They invited you."*
- **`/join/[token]`** — Mostly a router. Unauthenticated valid: card with workspace name + "Sign up" / "Sign in" buttons. Invalid/expired: serif headline *"This invite has expired."* + link home.
- **`/home`** — Top-right initials avatar (color derived from name hash) → dropdown with "Profile" and "Sign out." Serif greeting *"Hello, [display_name]."* Subhead = workspace name. If alone: the invite card. If paired: stacked initials avatars + a placeholder block *"Your trips will live here. Phase 3 brings the trip-creation flow."*
- **`/profile`** — Single column. Editable: display_name. Read-only: email, member-since date. Save → redirect to `/home`.

## Trade-offs & Acknowledged Risks

- **Email confirmation off**: typo in email = no password-reset path. Acceptable for trusted-pair MVP. Flip the Supabase setting + ship password-reset before any wider use.
- **Single-use invite + 14-day expiry**: mitigates leaked-link risk for trusted users. Not appropriate for a public product.
- **No "leave workspace" UI**: if a user is already in a workspace and accepts a second invite, they get a friendly dead-end. They'd need to manually delete their membership row to unblock. Acceptable for two-people MVP.

## Out of Scope (Phase 2)

Deliberately deferred. **Do not build these as part of Phase 2** even if they feel small:

- Password reset / forgot password flow
- Email change
- Account deletion (GDPR concern; personal-use only for now)
- "Leave workspace" UI
- Member removal by owner
- Workspace renaming UI (DB supports `UPDATE workspaces.name`; no settings page yet)
- Image upload for avatars (initials only)
- OAuth providers, magic-link auth
- Any email sent from our app (no welcome email, no "partner joined" notification)
- Workspace switcher (UI assumes one)
- Multi-member workspaces beyond 2 (DB supports it; Phase 2 invite UI is one-shot)

## Implementation Order (preview — full plan via `writing-plans` next)

1. **Schema migration** — tables, functions, RLS policies. Single SQL file. Verified locally.
2. **Sign-up form + `handle_new_user()` integration** — first end-to-end vertical slice. Create one real account.
3. **Sign-in form + sign-out handler** — round-trip the session.
4. **Proxy gating** — public/protected lists, `?next=` redirect.
5. **`/home` skeleton + initials avatar** — placeholder content, real auth check.
6. **Invite generation card** — `generateInvite()` Server Action + copy-link UI.
7. **`/join/[token]` flow** — unauthenticated card + signed-in `accept_invite` RPC call.
8. **`/profile` edit** — single-field form.
9. **End-to-end test** — sign up, invite, partner sign-up via invite, both see each other on `/home`.

Each is a small, validated increment. Failing increment → stop, root-cause, fix.
