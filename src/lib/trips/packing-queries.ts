import { createClient } from "@/lib/supabase/server"
import type { PackingItem } from "./packing-types"

export async function getPackingItems(
  tripId: string,
): Promise<PackingItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("packing_items")
    .select("id, trip_id, category, label, done, added_by, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }))
}
