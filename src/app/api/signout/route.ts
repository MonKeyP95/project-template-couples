import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // 303 See Other: tells the browser to switch to GET when following the redirect
  // after a POST. Default 307 preserves POST, which then 405s against the landing page.
  return NextResponse.redirect(
    new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    303,
  )
}
