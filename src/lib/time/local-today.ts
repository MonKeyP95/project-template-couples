import { cookies } from "next/headers"

import { TZ_COOKIE, todayInTimeZone } from "./today"

/** Device-local "today" (yyyy-mm-dd), read from the tz cookie. */
export async function localToday(): Promise<string> {
  const tz = (await cookies()).get(TZ_COOKIE)?.value || "UTC"
  return todayInTimeZone(tz)
}
