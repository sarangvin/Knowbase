// Example topics for the "what do you want to learn?" placeholder.
//
// A fixed trio taught every visitor the same three things about the product,
// and two of them were technical — which quietly implied this is a tool for
// programmers. Rotating a wide pool says the opposite in the only place
// someone reads before deciding what to type: cooking, history, music and
// botany sit next to Kubernetes, so whatever they arrived curious about
// looks like it belongs.
const TOPICS = [
  // Sciences
  'Marine biology', 'Astrophysics', 'Genetics', 'Volcanology', 'Immunology',
  'Particle physics', 'Neuroscience', 'Mycology', 'Oceanography', 'Botany',
  // History & humanities
  'Roman history', 'The Silk Road', 'Byzantine history', 'Ancient Egypt',
  'The Cold War', 'Medieval Japan', 'Philosophy of mind', 'Linguistics',
  'Norse mythology', 'Art history',
  // Practical & craft
  'French cooking', 'Bread baking', 'Woodworking', 'Home electrics',
  'Sourdough', 'Gardening', 'Sewing', 'Coffee roasting', 'Bike maintenance',
  // Music & arts
  'Music theory', 'Jazz harmony', 'Film photography', 'Screenwriting',
  'Watercolour', 'Poetry', 'Typography',
  // Technical
  'Kubernetes', 'Rust', 'Cryptography', 'Machine learning', 'Databases',
  'Computer networks', 'Compilers',
  // Money, society, self
  'Economics', 'Game theory', 'Personal finance', 'Negotiation',
  'Urban planning', 'Statistics', 'Chess openings', 'Sleep science',
]

/**
 * Three distinct examples, formatted for a placeholder.
 *
 * Call this once per mount (a useState initialiser, not inline in render):
 * re-rolling on every keystroke would make the field flicker under the
 * cursor while someone is reading it.
 */
export function randomTopicPlaceholder(count = 3): string {
  const pool = [...TOPICS]
  const picked: string[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    // Splice from a copy rather than filtering by value: guarantees three
    // *different* topics without relying on the pool having no duplicates.
    picked.push(...pool.splice(Math.floor(Math.random() * pool.length), 1))
  }
  return `e.g. ${picked.join(', ')}…`
}
