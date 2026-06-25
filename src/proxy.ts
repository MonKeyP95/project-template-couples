import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_ROUTES: ReadonlyArray<string> = [
  "/",
  "/signin",
  "/signup",
  "/api/signout",
]
const PUBLIC_ROUTE_PREFIXES: ReadonlyArray<string> = ["/join/", "/t/"]

function isPublic(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

// Copy any refreshed auth cookies set during getUser() onto a redirect response.
// Without this, an in-flight session refresh that coincides with a gate redirect
// is silently dropped and the user gets logged out on the next request.
function withRefreshedCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
  return target
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Normalize trailing slash so /signin/ matches /signin.
  const rawPath = request.nextUrl.pathname
  const pathname =
    rawPath !== "/" && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath

  // Authed user visiting auth pages → bounce to /home.
  if (user && (pathname === "/signin" || pathname === "/signup")) {
    return withRefreshedCookies(
      NextResponse.redirect(new URL("/home", request.url)),
      response,
    )
  }

  // Unauthed user visiting a protected page → bounce to /signin with ?next=.
  if (!user && !isPublic(pathname)) {
    const url = new URL("/signin", request.url)
    url.searchParams.set("next", pathname)
    return withRefreshedCookies(NextResponse.redirect(url), response)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
