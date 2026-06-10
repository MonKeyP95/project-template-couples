import { createClient } from "@/lib/supabase/server"

export interface TripNote {
  id: string
  tripId: string
  body: string
  locationId: string | null
  dayDate: string | null
  createdBy: string
  /** ISO timestamptz from Postgres. */
  createdAt: string
  updatedAt: string
}

interface TripNoteRow {
  id: string
  trip_id: string
  body: string
  location_id: string | null
  day_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

function rowToNote(r: TripNoteRow): TripNote {
  return {
    id: r.id,
    tripId: r.trip_id,
    body: r.body,
    locationId: r.location_id,
    dayDate: r.day_date,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const NOTE_COLS =
  "id, trip_id, body, location_id, day_date, created_by, created_at, updated_at"

export async function getTripNotes(tripId: string): Promise<TripNote[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_notes")
    .select(NOTE_COLS)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .returns<TripNoteRow[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToNote)
}

/** Notes tagged to a specific day (yyyy-mm-dd), newest first. */
export async function getNotesForDay(
  tripId: string,
  dayDate: string,
): Promise<TripNote[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_notes")
    .select(NOTE_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .order("created_at", { ascending: false })
    .returns<TripNoteRow[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToNote)
}

export { rowToNote }
