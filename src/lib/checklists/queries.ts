import { createClient } from "@/lib/supabase/server"
import type {
  Checklist,
  ChecklistCategory,
  ChecklistItem,
  ChecklistSummary,
} from "./types"

/** All checklists in the workspace with their progress counts, newest last. */
export async function listChecklists(
  workspaceId: string,
): Promise<ChecklistSummary[]> {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("checklists")
    .select("id, workspace_id, name, slug")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })

  const lists = rows ?? []
  const ids = lists.map((r) => r.id)
  const totals: Record<string, { total: number; done: number }> = {}
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from("checklist_items")
      .select("checklist_id, done")
      .in("checklist_id", ids)
    for (const it of items ?? []) {
      const t = (totals[it.checklist_id] ??= { total: 0, done: 0 })
      t.total += 1
      if (it.done) t.done += 1
    }
  }

  return lists.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    slug: r.slug,
    total: totals[r.id]?.total ?? 0,
    done: totals[r.id]?.done ?? 0,
  }))
}

/** A single checklist by slug within the workspace, or null. */
export async function getChecklistBySlug(
  workspaceId: string,
  slug: string,
): Promise<Checklist | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklists")
    .select("id, workspace_id, name, slug")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    slug: data.slug,
  }
}

export async function getChecklistItems(
  checklistId: string,
): Promise<ChecklistItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklist_items")
    .select("id, checklist_id, category, label, done, added_by, created_at")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    checklistId: row.checklist_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }))
}

export async function getChecklistCategories(
  checklistId: string,
): Promise<ChecklistCategory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklist_categories")
    .select("id, checklist_id, name, sort_order")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    checklistId: row.checklist_id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
}
