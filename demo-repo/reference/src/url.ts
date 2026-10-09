/** Returns a normalized http(s) URL, or null when the input is not acceptable. */
export function normalizeUrl(input: unknown): string | null {
  if (typeof input !== "string" || !input || input.length > 2048) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!/^[\w.-]+(\.[\w.-]+)+$/.test(u.hostname)) return null;
    return withScheme;
  } catch { return null; }
}
export const isValidUrl = (s: string) => normalizeUrl(s) !== null;
