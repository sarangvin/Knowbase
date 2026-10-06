// A random source that is the same every time for the same seed.
//
// "Random but spread across notes" used to mean Math.random, so dealing the
// same notes twice gave two different decks. The deck is stored the moment it
// is dealt, so that never mattered to the reader, but it made the choice
// impossible to reason about or test: the same reviews on the same day should
// produce the same cards. Seeded with the user and the day, they do.
export function seededRng(seed: string): () => number {
  // xmur3 string hash -> mulberry32 generator. Small, well-known, and plenty
  // for choosing cards; nothing here is secret.
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    a = (a + ((h ^= h >>> 16) >>> 0) + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number
