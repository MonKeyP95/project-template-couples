/**
 * Turn a free-form trip name into a URL-safe slug. Lowercase, strips
 * combining diacritics, collapses anything non-[a-z0-9] into single hyphens,
 * and trims leading/trailing hyphens. Pure: same input → same output.
 *
 * Examples:
 *   "Iceland ring road"     → "iceland-ring-road"
 *   "São Paulo 2027"        → "sao-paulo-2027"
 *   "  ---tokyo---  "       → "tokyo"
 *   ""                      → ""
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
