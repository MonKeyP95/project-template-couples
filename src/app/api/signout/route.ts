import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Origin comes from the request, not config: sign-out must land on whichever
  // deployment the user is actually signed in to.
  // 303 See Other: tells the browser to switch to GET when following the redirect
  // after a POST. Default 307 preserves POST, which then 405s against the landing page.
  const response = NextResponse.redirect(new URL("/", request.url), 303)
  // Wipes the stored on-the-road copy, the offline outbox and the worker.
  response.headers.set("Clear-Site-Data", '"cache", "storage"')
  return response
}
