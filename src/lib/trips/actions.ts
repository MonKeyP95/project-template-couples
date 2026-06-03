"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/trips/expense-types"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import type { PackingCategory } from "@/lib/trips/packing-types"
import { rowToNote, type TripNote } from "@/lib/trips/note-queries"
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
import {
  rowToDreamDay,
  type DreamDay,
} from "@/lib/trips/dream-itinerary-types"

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

export interface UpdatePackingItemResult {
  error?: string
}

/**
 * Renames a packing item. RLS gates trip membership. Realtime broadcasts the
 * UPDATE to both clients, so no revalidate is needed (matches togglePackingItem).
 */
export async function updatePackingItem(
  itemId: string,
  label: string,
): Promise<UpdatePackingItemResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("packing_items")
    .update({ label: trimmed })
    .eq("id", itemId)

  if (error) return { error: error.message }
  return {}
}

export interface DeletePackingItemResult {
  error?: string
}

/**
 * Deletes a packing item. RLS gates trip membership. The Realtime DELETE event
 * removes the row on both clients. Returns `{ error }` so the optimistic client
 * handler can revert on failure (matches togglePackingItem's shape).
 */
export async function deletePackingItem(
  itemId: string,
): Promise<DeletePackingItemResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("packing_items")
    .delete()
    .eq("id", itemId)

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
 * Computes a two-member trip's net balance. `net > 0` means the second member
 * owes the first; `debtor` is whoever owes. Mirrors `summarizeBudget`. Returns
 * `{ error }` for non-DB problems (missing trip, !=2 members) so each caller
 * decides whether to throw or surface it inline.
 */
async function loadTripBalance(
  tripId: string,
): Promise<{ net: number; debtor: string } | { error: string }> {
  const supabase = await createClient()

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("id", tripId)
    .maybeSingle()
  if (tripError) return { error: tripError.message }
  if (!trip) return { error: "Trip not found." }

  const { data: memberRows, error: membersError } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", trip.workspace_id)
  if (membersError) return { error: membersError.message }
  if (!memberRows || memberRows.length !== 2) {
    return { error: "Settle-up requires exactly 2 workspace members." }
  }

  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select("amount_cents, paid_by, is_settlement")
    .eq("trip_id", tripId)
  if (expensesError) return { error: expensesError.message }

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
  return { net, debtor: net > 0 ? b : a }
}

const TODAY = () => new Date().toISOString().slice(0, 10)

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
  const balance = await loadTripBalance(tripId)
  if ("error" in balance) throw new Error(balance.error)

  const { net, debtor } = balance
  if (net === 0) {
    revalidatePath(`/trips/${tripSlug}`)
    return
  }

  const supabase = await createClient()
  const { error: insertError } = await supabase.from("expenses").insert({
    trip_id: tripId,
    title: "Settlement",
    amount_cents: Math.abs(net),
    currency: "EUR",
    paid_by: debtor,
    category: "Settlement",
    day_date: TODAY(),
    is_settlement: true,
  })
  if (insertError) throw new Error(insertError.message)

  revalidatePath(`/trips/${tripSlug}`)
}

export interface PartialSettleResult {
  error?: string
}

/**
 * Records a partial settlement: the debtor pays `amount` toward what they owe.
 * Paying less than owed leaves a remainder; paying more flips the balance so
 * the other member now owes the difference. Returns `{ error }` so the inline
 * input can surface validation failures.
 */
export async function partialSettleUp(
  tripId: string,
  tripSlug: string,
  amount: string,
): Promise<PartialSettleResult> {
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { error: "Amount must be greater than zero." }
  }
  const cents = Math.round(amountNum * 100)
  if (cents >= MAX_AMOUNT_CENTS) return { error: "Amount out of range." }

  const balance = await loadTripBalance(tripId)
  if ("error" in balance) return { error: balance.error }

  const { net, debtor } = balance
  if (net === 0) return { error: "Already settled." }

  const supabase = await createClient()
  const { error: insertError } = await supabase.from("expenses").insert({
    trip_id: tripId,
    title: "Settlement",
    amount_cents: cents,
    currency: "EUR",
    paid_by: debtor,
    category: "Settlement",
    day_date: TODAY(),
    is_settlement: true,
  })
  if (insertError) return { error: insertError.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface UpdateExpenseInput {
  expenseId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
}

export interface UpdateExpenseResult {
  error?: string
}

/**
 * Edits a non-settlement expense in place. Validation mirrors `logExpense`.
 * Returns `{ error }` so the inline form can surface it. `is_settlement` is
 * never touched — settlement rows are delete-only from the UI.
 */
export async function updateExpense(
  input: UpdateExpenseInput,
): Promise<UpdateExpenseResult> {
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
  const { error } = await supabase
    .from("expenses")
    .update({
      title,
      amount_cents: cents,
      paid_by: input.paidBy,
      category: input.category,
      day_date: input.dayDate,
    })
    .eq("id", input.expenseId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

export interface DeleteExpenseResult {
  error?: string
}

/**
 * Permanently deletes an expense (regular or settlement). Returns `{ error }`
 * so the inline row can revert its optimistic removal on failure. Deleting a
 * settlement row is the supported "undo settle-up" path.
 */
export async function deleteExpense(
  expenseId: string,
  tripSlug: string,
): Promise<DeleteExpenseResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
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
  wasDream: boolean
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

  // --- Dream branch: null dates, optional fuzzy_when. ---
  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    const fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
    const { error } = await supabase
      .from("trips")
      .update({
        name,
        slug,
        country,
        start_date: null,
        end_date: null,
        fuzzy_when: fuzzyWhen,
        lat: input.lat,
        lng: input.lng,
      })
      .eq("id", input.tripId)
    if (error) {
      if (error.code === "23505") {
        return { error: "A trip with that slug already exists." }
      }
      return { error: error.message }
    }
    revalidatePath("/home")
    revalidatePath(`/trips/${input.currentSlug}`)
    return { slug }
  }

  // --- Dated branch (includes promotion of a dream). ---
  if (!input.startDate) return { error: "Start date required." }
  if (input.fuzzyWhen) {
    return { error: "Trips don't have a 'when?' label." }
  }

  // Promotion of a dream that already has planned days: derive the end date
  // from the day count and move the dream days onto consecutive dates.
  if (input.wasDream) {
    const { count } = await supabase
      .from("dream_itinerary_days")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", input.tripId)

    if ((count ?? 0) > 0) {
      // Update non-date fields first so a slug collision fails before we
      // convert anything.
      const { error: updateError } = await supabase
        .from("trips")
        .update({ name, slug, country, lat: input.lat, lng: input.lng })
        .eq("id", input.tripId)
      if (updateError) {
        if (updateError.code === "23505") {
          return { error: "A trip with that slug already exists." }
        }
        return { error: updateError.message }
      }

      // Atomic: set dates (start + count - 1), move dream days, delete originals.
      const { error: rpcError } = await supabase.rpc("promote_dream_to_dated", {
        p_trip_id: input.tripId,
        p_start_date: input.startDate,
      })
      if (rpcError) return { error: rpcError.message }

      revalidatePath("/home")
      revalidatePath(`/trips/${input.currentSlug}`)
      return { slug }
    }
  }

  // Normal dated edit (or promotion of a dream with no planned days).
  if (!input.endDate) return { error: "Start and end dates required." }
  if (input.endDate < input.startDate) {
    return { error: "End date must be on or after start date." }
  }

  const { error: updateError } = await supabase
    .from("trips")
    .update({
      name,
      slug,
      country,
      start_date: input.startDate,
      end_date: input.endDate,
      fuzzy_when: null,
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
  /** Optional inclusive end date. When later than dayDate, one entry per day in the range is created. */
  endDate?: string
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

/** Safety cap on how many days a single multi-day add can create. */
const MAX_RANGE_DAYS = 31

/** Inclusive list of yyyy-mm-dd dates from start to end. */
function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

/**
 * Inserts one or more itinerary days. With no endDate (or one equal to
 * dayDate) it creates a single day; a later endDate creates one identical,
 * independent entry per date in the inclusive range. RLS gates membership.
 * The unique (trip_id, day_date) constraint makes the range insert
 * all-or-nothing, so a collision rejects the whole range with a friendly error.
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

  const endDate = input.endDate?.trim() || input.dayDate
  if (!DATE_RE.test(endDate)) return { error: "Invalid date." }
  if (endDate < input.dayDate) {
    return { error: "End date must be on or after start date." }
  }
  const dates = enumerateDates(input.dayDate, endDate)
  if (dates.length > MAX_RANGE_DAYS) {
    return { error: `Range can span at most ${MAX_RANGE_DAYS} days.` }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const sub = input.sub.trim()

  // A multi-day span shares one group_id so the UI can mark "added together".
  const groupId = dates.length > 1 ? crypto.randomUUID() : null

  const rows = dates.map((day_date) => ({
    trip_id: input.tripId,
    day_date,
    title,
    sub,
    tag,
    tone: input.tone,
    group_id: groupId,
    created_by: userId,
  }))

  const { data, error } = await supabase
    .from("itinerary_days")
    .insert(rows)
    .select("id, day_date, title, sub, tag, tone, group_id")

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          dates.length > 1
            ? "Some days in that range are already planned."
            : "Another day already uses that date.",
      }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { day: rowToItineraryDay(data[0]) }
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

export interface AddPackingCategoryResult {
  error?: string
  /** Populated on success so the client can append it with a stable id. */
  category?: PackingCategory
}

/**
 * Creates a new (possibly empty) packing category at the end of the trip's
 * order. RLS gates trip membership. Duplicate name -> friendly error.
 */
export async function addPackingCategory(
  tripId: string,
  tripSlug: string,
  name: string,
): Promise<AddPackingCategoryResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("packing_categories")
    .select("sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("packing_categories")
    .insert({
      trip_id: tripId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, trip_id, name, sort_order")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A category with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {
    category: {
      id: data.id,
      tripId: data.trip_id,
      name: data.name,
      sortOrder: data.sort_order,
    },
  }
}

export interface DeletePackingCategoryResult {
  error?: string
}

/**
 * Deletes a category and cascades to its items (matched by name within the
 * trip). The empty-vs-non-empty distinction is a client-side confirm only;
 * the server cascades unconditionally because the client already confirmed.
 */
export async function deletePackingCategory(
  categoryId: string,
  tripSlug: string,
): Promise<DeletePackingCategoryResult> {
  const supabase = await createClient()

  const { data: cat, error: catError } = await supabase
    .from("packing_categories")
    .select("trip_id, name")
    .eq("id", categoryId)
    .maybeSingle()
  if (catError) return { error: catError.message }
  if (!cat) return {}

  const { error: itemsError } = await supabase
    .from("packing_items")
    .delete()
    .eq("trip_id", cat.trip_id)
    .eq("category", cat.name)
  if (itemsError) return { error: itemsError.message }

  const { error } = await supabase
    .from("packing_categories")
    .delete()
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface ReorderPackingCategoriesResult {
  error?: string
}

/**
 * Rewrites sort_order to match the given id order (sort_order = index). N is
 * tiny (categories per trip), so a short update loop is fine.
 */
export async function reorderPackingCategories(
  tripSlug: string,
  orderedIds: string[],
): Promise<ReorderPackingCategoriesResult> {
  const supabase = await createClient()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("packing_categories")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface RescheduleItineraryResult {
  error?: string
}

/**
 * Insertion-shift reschedule: reassigns the trip's existing dates (sorted) to
 * the days in the given id order, via the reschedule_itinerary_days RPC which
 * permutes them atomically under a deferred unique constraint. The existing
 * Realtime channel broadcasts the per-row UPDATEs to the partner.
 */
export async function rescheduleItineraryDays(
  tripId: string,
  tripSlug: string,
  orderedDayIds: string[],
): Promise<RescheduleItineraryResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reschedule_itinerary_days", {
    p_trip_id: tripId,
    p_day_ids: orderedDayIds,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface AddDreamDayInput {
  tripId: string
  tripSlug: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
  /** Number of identical days to create (default 1). Dreams have no dates. */
  count?: number
}

export interface AddDreamDayResult {
  error?: string
  /** Populated on success — full DreamDay (d ordinal is placeholder; client re-runs withDreamOrdinals). */
  day?: DreamDay
}

/**
 * Inserts one or more dream itinerary days at the end (day_index = max + 1,
 * max + 2, ...). `count` (default 1) creates that many identical, independent
 * entries. RLS gates membership. Returns the first inserted row so the client
 * can apply it via withDreamOrdinals optimistically.
 */
export async function addDreamItineraryDay(
  input: AddDreamDayInput,
): Promise<AddDreamDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const count = input.count ?? 1
  if (!Number.isInteger(count) || count < 1 || count > MAX_RANGE_DAYS) {
    return { error: `Days must be between 1 and ${MAX_RANGE_DAYS}.` }
  }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const { data: maxRow } = await supabase
    .from("dream_itinerary_days")
    .select("day_index")
    .eq("trip_id", input.tripId)
    .order("day_index", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextIndex = (maxRow?.day_index ?? 0) + 1

  const sub = input.sub.trim()

  const rows = Array.from({ length: count }, (_, i) => ({
    trip_id: input.tripId,
    day_index: nextIndex + i,
    title,
    sub,
    tag,
    tone: input.tone,
    created_by: userId,
  }))

  const { data, error } = await supabase
    .from("dream_itinerary_days")
    .insert(rows)
    .select("id, day_index, title, sub, tag, tone")

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { day: rowToDreamDay(data[0]) }
}

export interface UpdateDreamDayInput {
  dayId: string
  tripSlug: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface UpdateDreamDayResult {
  error?: string
}

/**
 * Edits an existing dream itinerary day. day_index is never user-edited, so no
 * collision concern. created_by and created_at never touched.
 */
export async function updateDreamItineraryDay(
  input: UpdateDreamDayInput,
): Promise<UpdateDreamDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const sub = input.sub.trim()

  const { error } = await supabase
    .from("dream_itinerary_days")
    .update({
      title,
      sub,
      tag,
      tone: input.tone,
    })
    .eq("id", input.dayId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Permanently deletes a dream itinerary day. Throws on error (form-action
 * shape). Leaves a gap in day_index; withDreamOrdinals re-pads display ordinals
 * on read, so the gap is invisible.
 */
export async function deleteDreamItineraryDay(
  dayId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("dream_itinerary_days")
    .delete()
    .eq("id", dayId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}

export interface RescheduleDreamResult {
  error?: string
}

/**
 * Insertion-shift reorder: reassigns the trip's existing day_index slots
 * (sorted) to the days in the given id order, via the
 * reschedule_dream_itinerary_days RPC which permutes them atomically under a
 * deferred unique constraint. The Realtime channel broadcasts the UPDATEs.
 */
export async function rescheduleDreamItineraryDays(
  tripId: string,
  tripSlug: string,
  orderedDayIds: string[],
): Promise<RescheduleDreamResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reschedule_dream_itinerary_days", {
    p_trip_id: tripId,
    p_day_ids: orderedDayIds,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface UpdateTripBudgetInput {
  tripId: string
  tripSlug: string
  plannedBudgetCents?: number
  savedCents?: number
}

export interface UpdateTripBudgetResult {
  error?: string
}

function validCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MAX_AMOUNT_CENTS
}

/**
 * Sets the trip's planned budget and/or saved-so-far total. Both are shared
 * workspace values; RLS gates membership. Only the provided field(s) are
 * written, so a one-figure edit never overwrites the other.
 */
export async function updateTripBudget(
  input: UpdateTripBudgetInput,
): Promise<UpdateTripBudgetResult> {
  const patch: { planned_budget_cents?: number; saved_cents?: number } = {}

  if (input.plannedBudgetCents !== undefined) {
    if (!validCents(input.plannedBudgetCents)) {
      return { error: "Budget out of range." }
    }
    patch.planned_budget_cents = input.plannedBudgetCents
  }

  if (input.savedCents !== undefined) {
    if (!validCents(input.savedCents)) {
      return { error: "Saved amount out of range." }
    }
    patch.saved_cents = input.savedCents
  }

  if (Object.keys(patch).length === 0) return { error: "Nothing to update." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("trips")
    .update(patch)
    .eq("id", input.tripId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
