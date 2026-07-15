# Onboarding routing Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread a guided baton-pass through the existing surfaces so a new dated trip flows new trip → profile wizard → guided itinerary planner.

**Architecture:** Additive URL-flag glue. `?tab=profile&onboarding=1` opens the profile wizard directly; its final button routes to `?tab=itinerary&plan=1`; `PlanItinerary` reads `plan=1` and auto-opens. Flags only bias initial state; they never gate navigation. No migration, no deps, no AI change, no new component.

**Tech Stack:** Next.js 16 App Router, React 19, `next/navigation` (`useRouter`, `useSearchParams`).

## Global Constraints

- No tests exist in this repo — validate each task with `pnpm lint`; validate the final task with `pnpm build`. Do not invent a test command.
- Scope: dated trips only. Dreams keep today's behavior.
- Onboarding props are optional so each intermediate change compiles.
- No emojis in code. Sparse comments. European date order not relevant here.

---

### Task 1: New-trip form sets the onboarding flag (dated trips)

**Files:**
- Modify: `src/app/trips/new/new-trip-form.tsx:67`

**Interfaces:**
- Produces: a dated create routes to `?tab=profile&onboarding=1`; a dream create routes to `?tab=profile` (unchanged flag-free).

- [ ] **Step 1: Change the post-create redirect to add the flag for dated trips**

Replace line 67:

```tsx
      router.push(`/trips/${result.slug}?tab=profile`)
```

with:

```tsx
      router.push(
        isDream
          ? `/trips/${result.slug}?tab=profile`
          : `/trips/${result.slug}?tab=profile&onboarding=1`,
      )
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/new/new-trip-form.tsx
git commit -m "feat(onboarding): dated new trip routes to profile with onboarding flag"
```

---

### Task 2: Page reads the onboarding flag and passes it to ProfileTab

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (searchParams type ~line 145; the `tab` read ~line 148; the `ProfileTab` render ~line 302-311)

**Interfaces:**
- Consumes: the `onboarding` query param.
- Produces: `ProfileTab` receives an `onboarding: boolean` prop.

- [ ] **Step 1: Widen the searchParams type and read the flag**

Change the `searchParams` type (currently `Promise<{ tab?: string }>`) to:

```tsx
  searchParams: Promise<{ tab?: string; onboarding?: string }>
```

Change the destructure (currently `const { tab } = await searchParams`) to:

```tsx
  const { tab, onboarding } = await searchParams
```

- [ ] **Step 2: Pass the flag to ProfileTab**

In the `ProfileTab` render, add the prop:

```tsx
          <ProfileTab
            profile={header.tripProfile}
            expenseCategories={expenseCategories ?? []}
            tripId={header.id}
            tripSlug={header.slug}
            destination={header.country ?? header.name}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
            onboarding={onboarding === "1"}
          />
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors (ProfileTab prop added in Task 3; this step may report a type error until Task 3 lands — acceptable within the same session, resolved before build).

Note: to keep each commit clean, do Task 2 and Task 3 back-to-back before committing Task 2. Commit both in Task 3's commit if lint fails standalone.

- [ ] **Step 4: Commit (only if lint is clean; otherwise fold into Task 3)**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(onboarding): page reads onboarding flag, passes to profile tab"
```

---

### Task 3: ProfileTab opens the wizard directly in onboarding

**Files:**
- Modify: `src/app/trips/[slug]/profile-tab.tsx`

**Interfaces:**
- Consumes: `onboarding: boolean` from Task 2.
- Produces: `ProfileWizard` receives an `onboarding` prop (defined in Task 4).

- [ ] **Step 1: Accept the prop and initialize editing state from it**

Replace the component signature and the `editing` state:

```tsx
export function ProfileTab({
  profile,
  expenseCategories,
  onboarding = false,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
  onboarding?: boolean
}) {
  const { tripId, tripSlug } = notesProps
  const [editing, setEditing] = React.useState(onboarding)
```

- [ ] **Step 2: Pass onboarding through to the wizard**

In the `ProfileWizard` render inside the `editing` branch, add the prop:

```tsx
        <ProfileWizard
          tripId={tripId}
          tripSlug={tripSlug}
          profile={profile}
          categories={expenseCategories}
          onboarding={onboarding}
          onDone={() => setEditing(false)}
        />
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors (ProfileWizard `onboarding` prop lands in Task 4; may type-error standalone — do Task 4 before committing if so).

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/page.tsx src/app/trips/[slug]/profile-tab.tsx
git commit -m "feat(onboarding): profile tab opens wizard directly when onboarding"
```

---

### Task 4: Wizard's final button becomes the baton-pass

**Files:**
- Modify: `src/app/trips/[slug]/profile-wizard.tsx` (props ~line 25-37; `save()` ~line 49-62; final button label ~line 169)

**Interfaces:**
- Consumes: `onboarding: boolean` from Task 3.
- Produces: on save success in onboarding, routes to `?tab=itinerary&plan=1` instead of calling `onDone()`.

- [ ] **Step 1: Add the optional prop**

Add `onboarding` to the destructured params and the type:

```tsx
export function ProfileWizard({
  tripId,
  tripSlug,
  profile,
  categories,
  onboarding = false,
  onDone,
}: {
  tripId: string
  tripSlug: string
  profile: TripProfile
  categories: ExpenseCategoryRow[]
  onboarding?: boolean
  onDone?: () => void
}) {
```

- [ ] **Step 2: Route to the itinerary planner on save in onboarding**

Replace the `save()` body's success tail. Current:

```tsx
      setSaved(true)
      router.refresh()
      onDone?.()
```

with:

```tsx
      setSaved(true)
      if (onboarding) {
        router.push(`/trips/${tripSlug}?tab=itinerary&plan=1`)
        return
      }
      router.refresh()
      onDone?.()
```

- [ ] **Step 3: Relabel the final button in onboarding**

Change the last-step button label (currently `{saving ? "saving…" : saved ? "saved" : "save profile"}`) to:

```tsx
            {saving
              ? "saving…"
              : saved
                ? "saved"
                : onboarding
                  ? "save & plan itinerary →"
                  : "save profile"}
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/profile-wizard.tsx
git commit -m "feat(onboarding): wizard save routes to guided itinerary when onboarding"
```

---

### Task 5: PlanItinerary auto-opens on the plan flag

**Files:**
- Modify: `src/app/trips/[slug]/plan-itinerary.tsx:4` (import) and `:43` (open state)

**Interfaces:**
- Consumes: the `plan` query param (`plan=1`).
- Produces: the guided stepper opens on arrival when `plan=1`; press-to-open still works otherwise.

- [ ] **Step 1: Import useSearchParams**

Change the import on line 4:

```tsx
import { useRouter, useSearchParams } from "next/navigation"
```

- [ ] **Step 2: Default open from the plan flag**

Below `const router = useRouter()` (line 42), read the param and use it as the initial open state. Replace:

```tsx
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
```

with:

```tsx
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(searchParams.get("plan") === "1")
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/plan-itinerary.tsx
git commit -m "feat(onboarding): itinerary planner auto-opens on plan flag"
```

---

## Self-Review

- **Spec coverage:** Flow steps 1-4 map to Tasks 1, 2+3, 4, 5 respectively. Dated-only scope honored (Task 1 branches on `isDream`). Never-a-gate honored (all props optional/default false; no redirects that block). No persistence added.
- **Placeholder scan:** none — every step shows exact code.
- **Type consistency:** `onboarding?: boolean` used identically in ProfileTab (Task 3) and ProfileWizard (Task 4); `plan=1` written in Task 4, read in Task 5; `onboarding=1` written in Task 1, read in Task 2.
- **Note on intermediate lint:** Tasks 2 and 3 add a prop consumed one task later; commit them together if a standalone lint type-errors (called out in-task).
