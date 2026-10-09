/** Returns true when the string looks like a URL we can redirect to. */
export function isValidUrl(input: string): boolean {
  if (!input || input.length > 2048) return false;
  return /^[\w.-]+(\.[\w.-]+)+(\/.*)?$/.test(input.replace(/^https?:\/\//, ""));
}
