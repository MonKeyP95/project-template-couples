"use client"

import * as React from "react"

import { NotesTab } from "./notes-tab"
import { ProfileWizard } from "./profile-wizard"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: the guided profile wizard (its categories step is the
 * shared expense_categories, also edited in Budget) above the reused Notes. */
export function ProfileTab({
  profile,
  expenseCategories,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
}) {
  const { tripId, tripSlug } = notesProps

  return (
    <>
      <ProfileWizard
        tripId={tripId}
        tripSlug={tripSlug}
        profile={profile}
        categories={expenseCategories}
      />
      <NotesTab {...notesProps} />
    </>
  )
}
