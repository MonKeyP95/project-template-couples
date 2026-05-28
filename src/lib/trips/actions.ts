"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { rowToNote, type TripNote } from "@/lib/trips/note-queries"
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-queries"

export interface ToggleResult {
  error?: string
}

export interface AddPackingItemResult {
  error?: string
}

/**
 * Flips a packing item's `done` flag. RLS enforces that the caller is a
 * workspace member of the trip; on success, Supabase Realtime broadcasts the
 * change to the partner's open clients.
 */
export async function togglePackingItem(
  itemId: string,
  done: boolean,
): Promise<ToggleResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("packing_items")
    .update({ done })
    .eq("id", itemId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Inserts a new packing item under the given category. RLS requires that
 * `added_by = auth.uid()` and that the caller is a member of the trip's
 * workspace. The Realtime channel on packing-tab will pick up the INSERT
 * and update both clients.
 */
export async function addPackingItem(
  tripId: string,
  category: string,
  label: string,
): Promise<AddPackingItemResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("packing_items").insert({
    trip_id: tripId,
    category,
    label: trimmed,
    added_by: userData.user.id,
  })

  if (error) return { error: error.message }
  return {}
}

export interface LogExpenseInput {
  tripId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
}

export interface LogExpenseResult {
  error?: string
}

// int4 ceiling — matches the type of expenses.amount_cents.
const MAX_AMOUNT_CENTS = 2_147_483_647

/**
 * Inserts a non-settlement expense row. Returns `{ error }` rather than
 * throwing so the client form can stay expanded and surface the error inline.
 */
export async function logExpense(
  input: LogExpenseInput,
): Promise<LogExpenseResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }

  const amountNum = Number(input.amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { error: "Amount must be greater than zero." }
  }
  const cents = Math.round(amountNum * 100)
  if (cents <= 0 || cents >= MAX_AMOUNT_CENTS) {
    return { error: "Amount out of range." }
  }

  if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
    return { error: "Invalid category." }
  }

  if (!input.paidBy) return { error: "Payer required." }

  if (input.dayDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dayDate)) {
    return { error: "Invalid day." }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("expenses").insert({
    trip_id: input.tripId,
    title,
    amount_cents: cents,
    currency: "EUR",
    paid_by: input.paidBy,
    category: input.category,
    day_date: input.dayDate,
    is_settlement: false,
  })

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Records a settlement row that brings the trip's net balance to zero.
 * Inserts paid_by = current debtor, amount = absolute net balance, so a
 * subsequent budget summary computes 0. Two-member trips only.
 *
 * Throws on error so it can be wired directly to `<form action={...}>`.
 */
export async function settleUp(
  tripId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("id", tripId)
    .maybeSingle()
  if (tripError) throw new Error(tripError.message)
  if (!trip) throw new Error("Trip not found.")

  const { data: memberRows, error: membersError } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", trip.workspace_id)
  if (membersError) throw new Error(membersError.message)
  if (!memberRows || memberRows.length !== 2) {
    throw new Error("Settle-up requires exactly 2 workspace members.")
  }

  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select("amount_cents, paid_by, is_settlement")
    .eq("trip_id", tripId)
  if (expensesError) throw new Error(expensesError.message)

  const [a, b] = memberRows.map((m) => m.user_id)
  let aPaid = 0
  let bPaid = 0
  let aTransfers = 0
  let bTransfers = 0
  for (const e of expenseRows ?? []) {
    if (e.is_settlement) {
      if (e.paid_by === a) aTransfers += e.amount_cents
      else if (e.paid_by === b) bTransfers += e.amount_cents
    } else {
      if (e.paid_by === a) aPaid += e.amount_cents
      else if (e.paid_by === b) bPaid += e.amount_cents
    }
  }

  const net = Math.round((aPaid - bPaid) / 2 + aTransfers - bTransfers)
  if (net === 0) {
    revalidatePath(`/trips/${tripSlug}`)
    return
  }
  const debtor = net > 0 ? b : a

  const { error: insertError } = await supabase.from("expenses").insert({
    trip_id: tripId,
    title: "Settlement",
    amount_cents: Math.abs(net),
    currency: "EUR",
    paid_by: debtor,
    category: "Settlement",
    is_settlement: true,
  })
  if (insertError) throw new Error(insertError.message)

  revalidatePath(`/trips/${tripSlug}`)
}

export interface CreateTripInput {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface CreateTripResult {
  error?: string
  /** Populated on success. Client navigates to /trips/<slug>. */
  slug?: string
}

const SLUG_RE = /^[a-z0-9-]+$/

/**
 * Creates a trip in the current workspace plus a trip_members row for every
 * workspace member. Returns `{ error }` on validation / DB failure so the form
 * can surface the message inline; returns `{ slug }` on success and lets the
 * client route to /trips/<slug>.
 */
export async function createTrip(
  input: CreateTripInput,
): Promise<CreateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
  }

  let startDate: string | null
  let endDate: string | null
  let fuzzyWhen: string | null

  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    startDate = null
    endDate = null
    fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
  } else {
    if (!input.startDate || !input.endDate) {
      return { error: "Start and end dates required." }
    }
    if (input.endDate < input.startDate) {
      return { error: "End date must be on or after start date." }
    }
    if (input.fuzzyWhen) {
      return { error: "Trips don't have a 'when?' label." }
    }
    startDate = input.startDate
    endDate = input.endDate
    fuzzyWhen = null
  }

  const hasLat = input.lat !== null
  const hasLng = input.lng !== null
  if (hasLat !== hasLng) {
    return { error: "Coordinates invalid." }
  }
  if (hasLat) {
    if (!Number.isFinite(input.lat) || input.lat! < -90 || input.lat! > 90) {
      return { error: "Coordinates invalid." }
    }
    if (!Number.isFinite(input.lng) || input.lng! < -180 || input.lng! > 180) {
      return { error: "Coordinates invalid." }
    }
  }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const country = input.country?.trim() || null

  const { error: insertError } = await supabase.from("trips").insert({
    workspace_id: workspace.id,
    slug,
    name,
    country,
    start_date: startDate,
    end_date: endDate,
    fuzzy_when: fuzzyWhen,
    lat: input.lat,
    lng: input.lng,
    created_by: userData.user.id,
  })

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: insertError.message }
  }

  const { data: tripRow, error: lookupError } = await supabase
    .from("trips")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("slug", slug)
    .maybeSingle()
  if (lookupError || !tripRow) {
    return { error: lookupError?.message ?? "Trip not found after insert." }
  }

  const memberRows = workspace.members.map((m) => ({
    trip_id: tripRow.id,
    user_id: m.user_id,
    role: "member" as const,
  }))
  const { error: membersError } = await supabase
    .from("trip_members")
    .insert(memberRows)
  if (membersError) return { error: membersError.message }

  return { slug }
}

export interface UpdateTripInput {
  tripId: string
  currentSlug: string
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface UpdateTripResult {
  error?: string
  /** New slug on success; client routes to /trips/<slug>. */
  slug?: string
}

/**
 * Updates an existing trip in-place. Validation mirrors `createTrip` so the
 * schema invariant (dream rows have null dates + optional fuzzy_when; trip
 * rows have both dates set + fuzzy_when null) is enforced on edit too.
 * Returns `{ error }` on validation/DB failure; `{ slug }` on success so the
 * client can route to the (possibly renamed) trip page.
 */
export async function updateTrip(
  input: UpdateTripInput,
): Promise<UpdateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
  }

  let startDate: string | null
  let endDate: string | null
  let fuzzyWhen: string | null

  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    startDate = null
    endDate = null
    fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
  } else {
    if (!input.startDate || !input.endDate) {
      return { error: "Start and end dates required." }
    }
    if (input.endDate < input.startDate) {
      return { error: "End date must be on or after start date." }
    }
    if (input.fuzzyWhen) {
      return { error: "Trips don't have a 'when?' label." }
    }
    startDate = input.startDate
    endDate = input.endDate
    fuzzyWhen = null
  }

  const hasLat = input.lat !== null
  const hasLng = input.lng !== null
  if (hasLat !== hasLng) {
    return { error: "Coordinates invalid." }
  }
  if (hasLat) {
    if (!Number.isFinite(input.lat) || input.lat! < -90 || input.lat! > 90) {
      return { error: "Coordinates invalid." }
    }
    if (!Number.isFinite(input.lng) || input.lng! < -180 || input.lng! > 180) {
      return { error: "Coordinates invalid." }
    }
  }

  const supabase = await createClient()
  const country = input.country?.trim() || null

  const { error: updateError } = await supabase
    .from("trips")
    .update({
      name,
      slug,
      country,
      start_date: startDate,
      end_date: endDate,
      fuzzy_when: fuzzyWhen,
      lat: input.lat,
      lng: input.lng,
    })
    .eq("id", input.tripId)

  if (updateError) {
    if (updateError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: updateError.message }
  }

  revalidatePath("/home")
  revalidatePath(`/trips/${input.currentSlug}`)
  return { slug }
}

/**
 * Permanently deletes a trip. Child tables (trip_members, packing_items,
 * expenses, itinerary_days) cascade automatically per the FKs declared in
 * the Phase 3 / 3.5 migrations. RLS enforces that the caller is a workspace
 * member of the trip.
 *
 * Throws on error (form-compatible like `settleUp`). On success, redirects
 * server-side to /home — the form caller does not need to handle navigation.
 */
export async function deleteTrip(
  tripId: string,
  currentSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("trips").delete().eq("id", tripId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${currentSlug}`)
  revalidatePath("/home")
  redirect("/home")
}

export interface AddNoteInput {
  tripId: string
  tripSlug: string
  body: string
}

export interface AddNoteResult {
  error?: string
  /** Populated on success — full row, so the client can prepend optimistically if it wants. */
  note?: TripNote
}

/**
 * Inserts a free-text note on a trip. RLS requires the caller to be a
 * workspace member of the trip and `created_by = auth.uid()`. Returns
 * `{ error }` on validation/DB failure; `{ note }` on success.
 */
export async function addNote(
  input: AddNoteInput,
): Promise<AddNoteResult> {
  const body = input.body.trim()
  if (!body) return { error: "Note body required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data, error } = await supabase
    .from("trip_notes")
    .insert({
      trip_id: input.tripId,
      body,
      created_by: userData.user.id,
    })
    .select("id, trip_id, body, created_by, created_at, updated_at")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { note: rowToNote(data) }
}

export interface UpdateNoteInput {
  noteId: string
  tripSlug: string
  body: string
}

export interface UpdateNoteResult {
  error?: string
}

/**
 * Edits the body of an existing note. RLS gates membership; `created_by`
 * and `created_at` are never touched. `updated_at` is set explicitly because
 * Postgres column defaults only fire on INSERT.
 */
export async function updateNote(
  input: UpdateNoteInput,
): Promise<UpdateNoteResult> {
  const body = input.body.trim()
  if (!body) return { error: "Note body required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_notes")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", input.noteId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Permanently deletes a note. Throws on error (form-compatible like
 * `deleteTrip` / `settleUp`). No cascade concerns — notes have no children.
 */
export async function deleteNote(
  noteId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_notes")
    .delete()
    .eq("id", noteId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}

export interface AddItineraryDayInput {
  tripId: string
  tripSlug: string
  dayDate: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface AddItineraryDayResult {
  error?: string
  /** Populated on success — full ItineraryDay (d ordinal is placeholder; client re-runs withOrdinals). */
  day?: ItineraryDay
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Inserts a new itinerary day. RLS gates membership. On unique-violation
 * (another day already uses this date), returns a friendly error. Returns
 * the inserted row as an ItineraryDay so the client can apply it via
 * withOrdinals optimistically.
 */
export async function addItineraryDay(
  input: AddItineraryDayInput,
): Promise<AddItineraryDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!DATE_RE.test(input.dayDate)) return { error: "Invalid date." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const sub = input.sub.trim()

  const { data, error } = await supabase
    .from("itinerary_days")
    .insert({
      trip_id: input.tripId,
      day_date: input.dayDate,
      title,
      sub,
      tag,
      tone: input.tone,
      created_by: userData.user.id,
    })
    .select("id, day_date, title, sub, tag, tone")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "Another day already uses that date." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { day: rowToItineraryDay(data) }
}

export interface UpdateItineraryDayInput {
  dayId: string
  tripSlug: string
  dayDate: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface UpdateItineraryDayResult {
  error?: string
}

/**
 * Edits an existing itinerary day. Same validation + collision-translation
 * shape as addItineraryDay. created_by and created_at never touched.
 */
export async function updateItineraryDay(
  input: UpdateItineraryDayInput,
): Promise<UpdateItineraryDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!DATE_RE.test(input.dayDate)) return { error: "Invalid date." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const sub = input.sub.trim()

  const { error } = await supabase
    .from("itinerary_days")
    .update({
      day_date: input.dayDate,
      title,
      sub,
      tag,
      tone: input.tone,
    })
    .eq("id", input.dayId)

  if (error) {
    if (error.code === "23505") {
      return { error: "Another day already uses that date." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Permanently deletes an itinerary day. Throws on error (form-action shape).
 * No cascade concerns — itinerary days have no children.
 */
export async function deleteItineraryDay(
  dayId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("itinerary_days")
    .delete()
    .eq("id", dayId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}
