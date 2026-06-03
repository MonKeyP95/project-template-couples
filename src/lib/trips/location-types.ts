export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return { id: row.id, name: row.name, sortOrder: row.sort_order }
}
