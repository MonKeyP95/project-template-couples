import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
} from "@/lib/workspace/active"

/** Relative paths only: `next` reaches us from a query string, so an absolute
 * URL here would make this an open redirect. */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/home"
}

async function switchWorkspace(request: Request, to: string, next: string) {
  const response = NextResponse.redirect(
    new URL(safeNext(next), request.url),
    303,
  )
  if (!to) return response

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return response

  // Membership is checked here rather than trusted from the form: the cookie
  // decides what every page reads, so an id the caller cannot access must not
  // reach it.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .eq("workspace_id", to)
    .maybeSingle()

  if (!membership) {
    return NextResponse.redirect(new URL("/home", request.url), 303)
  }

  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, to, {
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
    sameSite: "lax",
  })
  return response
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  return switchWorkspace(
    request,
    params.get("to") ?? "",
    params.get("next") ?? "/home",
  )
}

export async function POST(request: Request) {
  const form = await request.formData()
  return switchWorkspace(
    request,
    String(form.get("to") ?? ""),
    String(form.get("next") ?? "/home"),
  )
}
