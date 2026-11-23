// The example topic the homepage's pictures are drawn from. One is picked per
// visit and every mock on the page uses it, so the path, the note, the
// flashcard, the quiz and the highlight all tell one story. Ten of them, so a
// visitor who comes back sees that Rabbithole is not just about one subject.
//
// Every fact here is shown to strangers as an example of what the notes are
// like: keep them correct.

export interface Showcase {
  collection: string
  /** Two done, the one to read next, two locked. */
  path: [string, string, string, string, string]
  note: { title: string; body: string; points: [string, string] }
  card: { front: string; back: string }
  quiz: { q: string; options: [string, string, string]; right: 0 | 1 | 2 }
  dig: { before: string; mark: string; after: string; newNote: string; blurb: string }
}

export const SHOWCASES: Showcase[] = [
  {
    collection: 'Norse Mythology',
    path: ['The Nine Worlds', 'Odin and the Æsir', 'Yggdrasil', 'Loki the Trickster', 'Ragnarök'],
    note: {
      title: 'Yggdrasil, the World Tree',
      body: 'In Norse myth, nine worlds hang from the branches and roots of one enormous ash tree. An eagle sits at the top, a dragon gnaws at the roots, and a squirrel carries insults between them.',
      points: ['Why the gods meet at its roots every day', 'The three wells that water it'],
    },
    card: { front: 'Mímisbrunnr', back: 'The well of wisdom under Yggdrasil, where Odin gave an eye for a drink.' },
    quiz: { q: 'Who carries insults up and down the World Tree?', options: ['An eagle', 'A squirrel', 'A raven'], right: 1 },
    dig: { before: 'Odin hung on the tree for nine nights to win the ', mark: 'runes', after: ', the letters the Norse carved into stone and wood.', newNote: 'The Runic Alphabet', blurb: 'The oldest runic alphabet, the Elder Futhark, had 24 letters. It is named after its first six: f, u, th, a, r, k.' },
  },
  {
    collection: 'Black Holes',
    path: ['How Stars Die', 'Bending Spacetime', 'Event Horizons', 'Hawking Radiation', 'Picturing M87*'],
    note: {
      title: 'Event Horizons, the Point of No Return',
      body: 'An event horizon is not a surface you could touch. It is a boundary in space: inside it, escaping would mean moving faster than light, so nothing gets out, not even light itself.',
      points: ['Why clocks near the edge seem to slow down', 'How big the horizon of a Sun-mass black hole would be'],
    },
    card: { front: 'Schwarzschild radius', back: 'The radius of a non-rotating black hole’s event horizon. About 3 km for one with the mass of the Sun.' },
    quiz: { q: 'What can escape from inside an event horizon?', options: ['Light', 'Nothing', 'Radio waves'], right: 1 },
    dig: { before: 'Fall in feet first and tidal forces stretch you thin, a process physicists call ', mark: 'spaghettification', after: '.', newNote: 'Spaghettification', blurb: 'Gravity pulls harder on your feet than on your head. Near a small black hole that difference stretches anything falling in into a long, thin strand.' },
  },
  {
    collection: 'Ancient Egypt',
    path: ['The Gift of the Nile', 'Pharaohs as Gods', 'Mummification', 'The Book of the Dead', 'The Pyramids of Giza'],
    note: {
      title: 'Mummification, Step by Step',
      body: 'Embalmers removed most of the organs, dried the body under natron salt for about forty days, then wrapped it in layer after layer of linen. The heart was left in place: it would be weighed in the afterlife.',
      points: ['Why the brain was thrown away', 'The four canopic jars and their guardians'],
    },
    card: { front: 'Natron', back: 'A natural salt the Egyptians used to dry out a body before it was wrapped.' },
    quiz: { q: 'Which organ was usually left inside a mummy?', options: ['The brain', 'The heart', 'The liver'], right: 1 },
    dig: { before: 'Hieroglyphs were finally read again in 1822, thanks to the ', mark: 'Rosetta Stone', after: ' and its text in three scripts.', newNote: 'The Rosetta Stone', blurb: 'Carved in 196 BC, it repeats one decree in hieroglyphs, Demotic and Greek. Scholars used the Greek to crack the other two.' },
  },
  {
    collection: 'Game Theory',
    path: ['Payoff Matrices', 'Dominant Strategies', 'Prisoner’s Dilemma', 'Nash Equilibrium', 'Repeated Games'],
    note: {
      title: 'The Prisoner’s Dilemma',
      body: 'Two suspects are questioned in separate rooms. Each does better by betraying the other, whatever the other does. Yet if both stayed silent, both would be better off than when both betray.',
      points: ['How sensible choices add up to a worse outcome', 'Why playing again and again changes the answer'],
    },
    card: { front: 'Dominant strategy', back: 'A move that is your best choice no matter what the other player does.' },
    quiz: { q: 'In a one-off Prisoner’s Dilemma, what does a purely self-interested player choose?', options: ['Stay silent', 'Betray', 'Flip a coin'], right: 1 },
    dig: { before: 'The simple strategy ', mark: 'tit for tat', after: ' won Robert Axelrod’s famous computer tournaments of repeated games.', newNote: 'Tit for Tat', blurb: 'Cooperate on the first move, then copy whatever the other player did last time. Simple, forgiving and hard to exploit.' },
  },
  {
    collection: 'Coffee',
    path: ['Arabica and Robusta', 'From Cherry to Bean', 'Roasting', 'Extraction', 'Pulling an Espresso'],
    note: {
      title: 'How Roasting Works',
      body: 'Green coffee beans smell grassy and taste of almost nothing. Heat drives the Maillard reaction and caramelisation, building hundreds of aroma compounds, until steam bursts out of the beans with an audible crack.',
      points: ['What “first crack” tells a roaster', 'Why light roasts taste brighter and more acidic'],
    },
    card: { front: 'First crack', back: 'The popping sound beans make as steam breaks out of them, the sign a light roast is ready.' },
    quiz: { q: 'Which species makes up most of the world’s coffee?', options: ['Arabica', 'Robusta', 'Liberica'], right: 0 },
    dig: { before: 'Legend credits an Ethiopian goat herder named ', mark: 'Kaldi', after: ' with noticing his goats dancing after eating coffee cherries.', newNote: 'The Legend of Kaldi', blurb: 'The story first appears in writing in 1671, long after coffee was already being drunk in Yemen. Historians treat it as legend, not history.' },
  },
  {
    collection: 'Sleep',
    path: ['Circadian Rhythms', 'Melatonin', 'REM Sleep', 'Why We Dream', 'Sleep Debt'],
    note: {
      title: 'REM Sleep',
      body: 'About every ninety minutes the sleeping brain switches into REM: the eyes dart, brain activity looks almost awake, and the most vivid dreams happen. Meanwhile most of the body’s muscles go limp.',
      points: ['Why your body stops you acting out dreams', 'Why REM periods get longer towards morning'],
    },
    card: { front: 'REM atonia', back: 'The temporary paralysis of most muscles during REM sleep.' },
    quiz: { q: 'Roughly how long is one sleep cycle?', options: ['30 minutes', '90 minutes', '3 hours'], right: 1 },
    dig: { before: 'The longer you are awake, the more ', mark: 'adenosine', after: ' builds up in the brain, and caffeine works by blocking it.', newNote: 'Adenosine and Sleep Pressure', blurb: 'Adenosine builds up with every waking hour and makes you sleepier. Caffeine blocks its receptors, so you feel alert while the pressure keeps building.' },
  },
  {
    collection: 'The Roman Empire',
    path: ['The Republic Falls', 'Augustus', 'Roman Roads', 'The Colosseum', 'The Fall of the West'],
    note: {
      title: 'Roads That Held an Empire',
      body: 'At its height Rome had tens of thousands of kilometres of paved roads. Layers of rubble, gravel and fitted stone, cambered so rain ran off, let armies and messages cross the empire at speed.',
      points: ['Why the roads ran so straight', 'How milestones measured the empire'],
    },
    card: { front: 'Via Appia', back: 'Rome’s first great road, begun in 312 BC and running south from the city.' },
    quiz: { q: 'What helped Roman concrete set even under seawater?', options: ['Sea salt', 'Volcanic ash', 'Crushed shells'], right: 1 },
    dig: { before: 'Roman harbour walls still stand because their concrete was made with ', mark: 'pozzolana', after: ', a volcanic ash.', newNote: 'Roman Concrete', blurb: 'Lime and volcanic ash react with seawater to grow new minerals inside the concrete, so Roman harbour walls got stronger over the centuries.' },
  },
  {
    collection: 'Octopuses',
    path: ['Meet the Cephalopods', 'Three Hearts', 'Changing Colour', 'Thinking Arms', 'Short, Fast Lives'],
    note: {
      title: 'How Octopuses Change Colour',
      body: 'An octopus’s skin is packed with chromatophores, tiny sacs of pigment ringed by muscle. Stretching or squeezing them redraws the pattern on its body in a fraction of a second.',
      points: ['How they copy the texture of rocks and weed', 'The puzzle of matching colours they may not see'],
    },
    card: { front: 'Chromatophore', back: 'A sac of pigment in the skin that muscles stretch or squeeze to change colour.' },
    quiz: { q: 'How many hearts does an octopus have?', options: ['One', 'Two', 'Three'], right: 2 },
    dig: { before: 'Octopus blood is blue because it carries oxygen with ', mark: 'hemocyanin', after: ', a protein built around copper.', newNote: 'Blue Blood', blurb: 'Hemocyanin carries oxygen with copper instead of iron. It is almost colourless on its own and turns blue when it picks up oxygen.' },
  },
  {
    collection: 'Bread Baking',
    path: ['Flour and Gluten', 'Wild Yeast', 'The Starter', 'Shaping a Loaf', 'Baking with Steam'],
    note: {
      title: 'Keeping a Sourdough Starter',
      body: 'A starter is flour and water colonised by wild yeast and lactic acid bacteria. The yeast makes the gas that lifts the bread; the bacteria make the acids that give sourdough its tang.',
      points: ['Why it needs feeding so often', 'What the grey liquid on top is telling you'],
    },
    card: { front: 'Levain', back: 'A portion of starter built up to raise one batch of dough.' },
    quiz: { q: 'What gives sourdough its sour taste?', options: ['The yeast', 'Lactic acid bacteria', 'Added vinegar'], right: 1 },
    dig: { before: 'A loaf rises fast in its first minutes in a hot oven, a burst bakers call ', mark: 'oven spring', after: '.', newNote: 'Oven Spring', blurb: 'Heat makes the gas in the dough expand and the yeast work faster for a few minutes, until the crust sets. Steam keeps the crust soft so the loaf can rise further.' },
  },
  {
    collection: 'How Planes Fly',
    path: ['Air Pressure', 'The Four Forces', 'Making Lift', 'Stalls', 'Jet Engines'],
    note: {
      title: 'How Wings Make Lift',
      body: 'A wing meets the air at a slight angle and turns the flow downward. Air speeds up over the curved top, the pressure there drops, and the difference between top and bottom holds the plane up.',
      points: ['Why the “equal transit time” story is wrong', 'What angle of attack does'],
    },
    card: { front: 'Angle of attack', back: 'The angle between the wing and the oncoming air. Too steep and the wing stalls.' },
    quiz: { q: 'What happens when a wing’s angle of attack gets too steep?', options: ['It keeps gaining lift', 'It stalls', 'The engines stop'], right: 1 },
    dig: { before: 'The small upturned ', mark: 'winglets', after: ' on an airliner’s wing tips cut the drag from swirling tip vortices.', newNote: 'Winglets', blurb: 'Air spills around a wing tip from the high-pressure underside to the top, forming a drag-causing vortex. Winglets weaken it and save a few percent of fuel.' },
  },
]

const LAST_KEY = 'rabbithole.showcase'

/** A random topic, never the one this browser saw last time. */
export function pickShowcase(): Showcase {
  let last = -1
  try {
    last = Number(localStorage.getItem(LAST_KEY) ?? -1)
  } catch {
    // storage blocked: any topic will do
  }
  let i = Math.floor(Math.random() * SHOWCASES.length)
  if (i === last) i = (i + 1 + Math.floor(Math.random() * (SHOWCASES.length - 1))) % SHOWCASES.length
  try {
    localStorage.setItem(LAST_KEY, String(i))
  } catch {
    // fine
  }
  return SHOWCASES[i]
}
