const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Returns a random slug of the given length. */
export function randomSlug(length = 6, rand: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}
