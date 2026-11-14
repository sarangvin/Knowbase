// The icon a collection is drawn with on the home screen: one name from a
// fixed set of monochrome icons (lucide), layered on the orange tile. The
// same list is rendered by src/features/automated-graph/topicIcons.tsx;
// keep the two in step.
//
// Chosen by the planner when a collection is made (onboarding/plan.ts asks
// for it in the same call), or by runIconBackfill.ts for older ones, and
// stored per collection name in collection_icons, so every reader's copy of
// a library collection shares one.
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { normalizeTopic } from './spaces.js'

export const ICON_NAMES = [
  'Atom', 'FlaskConical', 'Dna', 'Microscope', 'Brain', 'HeartPulse', 'Stethoscope', 'Pill',
  'Leaf', 'Sprout', 'TreePine', 'Flower2', 'Bug', 'Fish', 'Bird', 'PawPrint',
  'Mountain', 'Waves', 'Globe', 'Map', 'Compass', 'Telescope', 'Rocket', 'Orbit',
  'Sun', 'Moon', 'Zap', 'Flame', 'Snowflake', 'CloudRain', 'Landmark', 'Castle',
  'Crown', 'Swords', 'Shield', 'Scroll', 'BookOpen', 'Feather', 'PenTool', 'Palette',
  'Brush', 'Camera', 'Film', 'Music', 'Guitar', 'Mic', 'Drama', 'Gamepad2',
  'Puzzle', 'Dice5', 'TrendingUp', 'ChartLine', 'Coins', 'Banknote', 'PiggyBank', 'Briefcase',
  'Building2', 'Scale', 'Gavel', 'Users', 'Baby', 'Languages', 'MessageCircle', 'Code',
  'Cpu', 'Server', 'Database', 'Network', 'Lock', 'Calculator', 'Sigma', 'Ruler',
  'Wrench', 'Hammer', 'Car', 'Bike', 'Plane', 'Ship', 'TrainFront', 'Utensils',
  'ChefHat', 'Coffee', 'Wine', 'Croissant', 'Shirt', 'Scissors', 'House', 'Lightbulb',
  'Sparkles', 'Eye', 'Ear', 'Dumbbell', 'Trophy', 'Medal', 'Church', 'Disc3',
  'Hourglass', 'Skull', 'Ghost', 'Gem', 'Anchor', 'Magnet', 'Bone', 'Shell',
  'Pyramid', 'Smartphone', 'Megaphone', 'ShoppingCart', 'Store', 'Factory', 'Tractor', 'Wheat',
  'Salad', 'Hexagon', 'Infinity', 'Radio', 'Tv', 'Headphones', 'Clapperboard', 'Handshake',
  'GraduationCap', 'Library', 'Newspaper', 'Glasses', 'Footprints', 'Snail', 'Rabbit', 'Cat',
  'Dog', 'Egg', 'Apple', 'Cherry', 'Candy',
] as const

const known = new Set<string>(ICON_NAMES)

export function validIcon(name: unknown): string | null {
  return typeof name === 'string' && known.has(name.trim()) ? name.trim() : null
}

/** Remember a collection's icon. Never overwrites one already chosen. */
export async function saveIcon(space: string, icon: string | null): Promise<void> {
  if (!icon) return
  await db.execute(sql`
    INSERT INTO collection_icons (key, icon) VALUES (${normalizeTopic(space)}, ${icon})
    ON CONFLICT (key) DO NOTHING
  `)
}

/** Every chosen icon, by normalised collection name. */
export async function allIcons(): Promise<Record<string, string>> {
  const rows = (await db.execute(sql`SELECT key, icon FROM collection_icons`)).rows as { key: string; icon: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.icon]))
}
