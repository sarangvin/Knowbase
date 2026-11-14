// One pastel colour per collection on the graph.
//
// The colour comes from the collection's name, not from its position in a
// list, so "Game Theory" is the same colour every day, on every device, with
// nothing stored: a name hashes to a slot in the palette.
//
// Two of a reader's collections can hash to the same slot. Then the one whose
// name sorts later takes the next free slot, so the colours on one graph are
// always distinct. The cost: a new collection that lands on an occupied slot
// and sorts earlier moves the other one along. With ten slots and a
// handful of collections that is rare, and it is the price of never showing
// two collections in one colour.
//
// Pastels because the graph is dark and dense: saturated colours on a dark
// background vibrate, these sit back.
export const PASTELS = [
  // Ten hues far enough apart to tell at a glance on a dark background. A
  // pink and a periwinkle were cut: beside rose and lavender they read as
  // the same colour, and three names landed on exactly those.
  '#F4A7A3', // rose
  '#F7C59F', // peach
  '#F3E19B', // butter
  '#C5E3A0', // pistachio
  '#9EDDC4', // mint
  '#9ED3E6', // aqua
  '#A9BFF2', // sky
  '#CDB3F0', // lavender
  '#D9C6A5', // sand
  '#B8CBC0', // sage
]

/** FNV-1a, on the lowercased name, so "game theory" and "Game Theory" agree. */
function hash(name: string): number {
  let h = 0x811c9dc5
  for (const ch of name.toLowerCase()) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Collection name -> colour, for one reader's set of collections. */
/** The same ten hues, deep enough to read on the light theme's paper. Index
 *  for index with PASTELS, so a collection keeps its hue across themes. */
export const DEEPS = [
  '#C9524B', // rose
  '#C8763A', // peach
  '#A88A12', // butter
  '#5E8F2E', // pistachio
  '#2E8F6A', // mint
  '#2A86A6', // aqua
  '#4766C2', // sky
  '#7F55C7', // lavender
  '#8C6E3E', // sand
  '#5B7D6C', // sage
]

export function collectionColors(spaces: Iterable<string>, light = false): Map<string, string> {
  const palette = light ? DEEPS : PASTELS
  const out = new Map<string, string>()
  const taken = new Set<number>()
  // Sorted, so who yields on a collision does not depend on vault order.
  for (const space of [...new Set(spaces)].sort((a, b) => a.localeCompare(b))) {
    let slot = hash(space) % palette.length
    // Every slot taken (more than ten collections): share, rather than
    // loop forever.
    for (let i = 0; i < palette.length && taken.has(slot); i++) slot = (slot + 1) % palette.length
    taken.add(slot)
    out.set(space, palette[slot])
  }
  return out
}
