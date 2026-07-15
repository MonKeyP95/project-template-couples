"use client"

import * as React from "react"

import { NotesTab } from "./notes-tab"
import { ProfileOverview } from "./profile-overview"
import { ProfileWizard } from "./profile-wizard"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: a read-only overview of the profile that swaps in
 * the guided wizard on "Edit profile" (its categories step is the shared
 * expense_categories, also edited in Budget), above the reused Notes. */
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

  return (
    <>
      {editing ? (
        <ProfileWizard
          tripId={tripId}
          tripSlug={tripSlug}
          profile={profile}
          categories={expenseCategories}
          onboarding={onboarding}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ProfileOverview
          profile={profile}
          categories={expenseCategories}
          onEdit={() => setEditing(true)}
        />
      )}
      <NotesTab {...notesProps} />
    </>
  )
}
