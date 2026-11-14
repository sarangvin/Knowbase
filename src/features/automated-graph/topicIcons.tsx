// A collection's logo: a monochrome icon on the orange tile.
//
// Which icon is decided on the server (backend/src/vault/topicIcons.ts holds
// the same list): by the planner when the collection is made, or by the
// icon backfill for older ones. Until a collection has one, a keyword guess
// from its name stands in, so nothing is ever drawn without a logo.
import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LowPoly } from './LowPoly'
import {
  Atom, FlaskConical, Dna, Microscope, Brain, HeartPulse, Stethoscope, Pill,
  Leaf, Sprout, TreePine, Flower2, Bug, Fish, Bird, PawPrint,
  Mountain, Waves, Globe, Map, Compass, Telescope, Rocket, Orbit,
  Sun, Moon, Zap, Flame, Snowflake, CloudRain, Landmark, Castle,
  Crown, Swords, Shield, Scroll, BookOpen, Feather, PenTool, Palette,
  Brush, Camera, Film, Music, Guitar, Mic, Drama, Gamepad2,
  Puzzle, Dice5, TrendingUp, ChartLine, Coins, Banknote, PiggyBank, Briefcase,
  Building2, Scale, Gavel, Users, Baby, Languages, MessageCircle, Code,
  Cpu, Server, Database, Network, Lock, Calculator, Sigma, Ruler,
  Wrench, Hammer, Car, Bike, Plane, Ship, TrainFront, Utensils,
  ChefHat, Coffee, Wine, Croissant, Shirt, Scissors, House, Lightbulb,
  Sparkles, Eye, Ear, Dumbbell, Trophy, Medal, Church, Disc3,
  Hourglass, Skull, Ghost, Gem, Anchor, Magnet, Bone, Shell,
  Pyramid, Smartphone, Megaphone, ShoppingCart, Store, Factory, Tractor, Wheat,
  Salad, Hexagon, Infinity, Radio, Tv, Headphones, Clapperboard, Handshake,
  GraduationCap, Library, Newspaper, Glasses, Footprints, Snail, Rabbit, Cat,
  Dog, Egg, Apple, Cherry, Candy,
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  Atom, FlaskConical, Dna, Microscope, Brain, HeartPulse, Stethoscope, Pill,
  Leaf, Sprout, TreePine, Flower2, Bug, Fish, Bird, PawPrint,
  Mountain, Waves, Globe, Map, Compass, Telescope, Rocket, Orbit,
  Sun, Moon, Zap, Flame, Snowflake, CloudRain, Landmark, Castle,
  Crown, Swords, Shield, Scroll, BookOpen, Feather, PenTool, Palette,
  Brush, Camera, Film, Music, Guitar, Mic, Drama, Gamepad2,
  Puzzle, Dice5, TrendingUp, ChartLine, Coins, Banknote, PiggyBank, Briefcase,
  Building2, Scale, Gavel, Users, Baby, Languages, MessageCircle, Code,
  Cpu, Server, Database, Network, Lock, Calculator, Sigma, Ruler,
  Wrench, Hammer, Car, Bike, Plane, Ship, TrainFront, Utensils,
  ChefHat, Coffee, Wine, Croissant, Shirt, Scissors, House, Lightbulb,
  Sparkles, Eye, Ear, Dumbbell, Trophy, Medal, Church, Disc3,
  Hourglass, Skull, Ghost, Gem, Anchor, Magnet, Bone, Shell,
  Pyramid, Smartphone, Megaphone, ShoppingCart, Store, Factory, Tractor, Wheat,
  Salad, Hexagon, Infinity, Radio, Tv, Headphones, Clapperboard, Handshake,
  GraduationCap, Library, Newspaper, Glasses, Footprints, Snail, Rabbit, Cat,
  Dog, Egg, Apple, Cherry, Candy,
}

/** Keyword guesses, first match wins, for collections with no chosen icon. */
const GUESSES: [RegExp, string][] = [
  [/physic|quantum|particle|atom|entropy|magnet|charge/i, 'Atom'],
  [/chem/i, 'FlaskConical'],
  [/gene|dna|ancestry|evolution/i, 'Dna'],
  [/neuro|brain|psycholog|mind|behavio/i, 'Brain'],
  [/medic|anatomy|health|immun|mri|tinnitus|sleep/i, 'HeartPulse'],
  [/marine|ocean|sea|trench|fish/i, 'Waves'],
  [/bota|plant|garden|mycolog|fung|tree/i, 'Sprout'],
  [/astro|space|cosmos|star|planet|black hole/i, 'Telescope'],
  [/volcan|geolog|mountain|earth/i, 'Mountain'],
  [/geograph|travel|silk road|world/i, 'Globe'],
  [/myth|norse|greek|god/i, 'Swords'],
  [/histor|egypt|roman|byzant|war|medieval|empire/i, 'Landmark'],
  [/poe|writ|literat|book|plath|screen/i, 'Feather'],
  [/art|paint|watercol|draw|animation|typograph/i, 'Palette'],
  [/photo|film|camera/i, 'Camera'],
  [/music|jazz|song|dj|rekordbox|harmony/i, 'Music'],
  [/game|chess|naruto|doom|frisbee|sport/i, 'Gamepad2'],
  [/stock|invest|trading|valuation|market|financ|econom|inflation|money/i, 'TrendingUp'],
  [/law|justice|racism|patriarchy|women|society/i, 'Scale'],
  [/languag|french|linguist/i, 'Languages'],
  [/code|coding|program|rust|compiler|software|kubernetes|cloud|data|machine learning|ai\b|llm|agent/i, 'Code'],
  [/crypto|security|cyber/i, 'Lock'],
  [/statistic|math|calcul|probab|forecast|regression|descent/i, 'Sigma'],
  [/engineer|structure|mechanic|electric|cad|manufactur/i, 'Wrench'],
  [/cook|culinar|food|bak|bread|sourdough|salt|chutney|samosa/i, 'ChefHat'],
  [/coffee|tea|hojicha/i, 'Coffee'],
  [/elephant|animal|lobster|bee|wildlife/i, 'PawPrint'],
  [/bike|car|vehicle/i, 'Bike'],
  [/product|business|negotiat|career|consumer|advertis|instagram|content/i, 'Briefcase'],
]

/** Every chosen icon, fetched once per page load and shared. */
let cache: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null
function loadIcons(): Promise<Record<string, string>> {
  pending ??= fetch('/api/vaults/icons')
    .then((r) => (r.ok ? (r.json() as Promise<{ icons: Record<string, string> }>) : { icons: {} }))
    .then((d) => (cache = d.icons))
    .catch(() => (cache = {}))
  return pending
}

/** Same normalisation as the server's normalizeTopic: case and punctuation are noise. */
function keyOf(space: string): string {
  return space.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function iconNameFor(space: string, chosen: Record<string, string> | null): string {
  const picked = chosen?.[keyOf(space)]
  if (picked && ICONS[picked]) return picked
  return GUESSES.find(([re]) => re.test(space))?.[1] ?? 'BookOpen'
}

export function TopicIcon({ space, size = 22 }: { space: string; size?: number }) {
  const [chosen, setChosen] = useState(cache)
  useEffect(() => {
    if (!cache) void loadIcons().then(setChosen)
  }, [])
  const Icon = ICONS[iconNameFor(space, chosen)] ?? BookOpen
  return (
    <span className="topic-icon" aria-hidden="true">
      <LowPoly seed={space} />
      <Icon className="topic-icon-glyph" width={size} height={size} strokeWidth={2} />
    </span>
  )
}
