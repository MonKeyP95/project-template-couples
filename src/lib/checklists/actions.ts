"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import type { ChecklistCategory } from "./types"

export interface ChecklistResult {
  error?: string
}

export interface CreateChecklistResult {
  error?: string
  /** On success; the client navigates to /checklists/<slug>. */
  slug?: string
}

/** Lowercase, dash-joined ascii slug; falls back to "list". */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return s || "list"
}

/** Creates an empty checklist in the current workspace with a unique slug. */
export async function createChecklist(
  name: string,
): Promise<CreateChecklistResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const base = slugify(trimmed)
  const { data: existing } = await supabase
    .from("checklists")
    .select("slug")
    .eq("workspace_id", workspace.id)
    .like("slug", `${base}%`)
  const taken = new Set((existing ?? []).map((r) => r.slug))
  let slug = base
  let n = 2
  while (taken.has(slug)) slug = `${base}-${n++}`

  const { error } = await supabase.from("checklists").insert({
    workspace_id: workspace.id,
    name: trimmed,
    slug,
    created_by: userData.user.id,
  })
  if (error) {
    if (error.code === "23505") {
      return { error: "A checklist with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath("/checklists")
  return { slug }
}

/** Renames a checklist; the slug (and URL) stays put. */
export async function renameChecklist(
  checklistId: string,
  slug: string,
  name: string,
): Promise<ChecklistResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("checklists")
    .update({ name: trimmed })
    .eq("id", checklistId)
  if (error) return { error: error.message }

  revalidatePath("/checklists")
  revalidatePath(`/checklists/${slug}`)
  return {}
}

/** Deletes a checklist (cascades to its categories + items via FKs). The client
 * navigates to /checklists on success. */
export async function deleteChecklist(
  checklistId: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklists")
    .delete()
    .eq("id", checklistId)
  if (error) return { error: error.message }

  revalidatePath("/checklists")
  return {}
}

/** Unchecks every item so the template is fresh to reuse. */
export async function resetChecklist(
  checklistId: string,
  slug: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ done: false })
    .eq("checklist_id", checklistId)
    .eq("done", true)
  if (error) return { error: error.message }

  revalidatePath(`/checklists/${slug}`)
  return {}
}

export async function addChecklistItem(
  checklistId: string,
  category: string,
  label: string,
): Promise<ChecklistResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("checklist_items").insert({
    checklist_id: checklistId,
    category,
    label: trimmed,
    added_by: userData.user.id,
  })
  if (error) return { error: error.message }
  return {}
}

export async function toggleChecklistItem(
  itemId: string,
  done: boolean,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ done })
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export async function updateChecklistItem(
  itemId: string,
  label: string,
): Promise<ChecklistResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ label: trimmed })
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export async function deleteChecklistItem(
  itemId: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export interface AddChecklistCategoryResult {
  error?: string
  /** Populated on success so the client can append it with a stable id. */
  category?: ChecklistCategory
}

export async function addChecklistCategory(
  checklistId: string,
  slug: string,
  name: string,
): Promise<AddChecklistCategoryResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("checklist_categories")
    .select("sort_order")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("checklist_categories")
    .insert({
      checklist_id: checklistId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, checklist_id, name, sort_order")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A category with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath(`/checklists/${slug}`)
  return {
    category: {
      id: data.id,
      checklistId: data.checklist_id,
      name: data.name,
      sortOrder: data.sort_order,
    },
  }
}

export async function deleteChecklistCategory(
  categoryId: string,
  slug: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()

  const { data: cat, error: catError } = await supabase
    .from("checklist_categories")
    .select("checklist_id, name")
    .eq("id", categoryId)
    .maybeSingle()
  if (catError) return { error: catError.message }
  if (!cat) return {}

  const { error: itemsError } = await supabase
    .from("checklist_items")
    .delete()
    .eq("checklist_id", cat.checklist_id)
    .eq("category", cat.name)
  if (itemsError) return { error: itemsError.message }

  const { error } = await supabase
    .from("checklist_categories")
    .delete()
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/checklists/${slug}`)
  return {}
}
