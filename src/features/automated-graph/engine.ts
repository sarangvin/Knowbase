// Native reimplementation of the vault's Dataview JS dashboards (Next Up / Today /
// Flashcards), computed from topic-note frontmatter. Mirrors the algorithms in the
// real .md files exactly. Pure — no React, no store.
import type { Note, VaultIndex } from '../../vault/types'
import { resolveTarget } from '../../vault/graph'

export interface SpaceConfig {
  confidence_threshold: number
  weight_importance: number
  weight_unlocks: number
  weight_interest: number
  review_interval_days: number
}

const DEFAULT_CONFIG: SpaceConfig = {
  confidence_threshold: 3,
  weight_importance: 1,
  weight_unlocks: 2,
  weight_interest: 0.5,
  review_interval_days: 30,
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** "Automated Graph/<Space>/..." -> "<Space>". */
export function spaceOfPath(path: string): string | null {
  const m = path.match(/^Automated Graph\/([^/]+)\//)
  return m ? m[1] : null
}

export function listSpaces(index: VaultIndex): string[] {
  const spaces = new Set<string>()
  for (const p of index.notes.keys()) {
    if (/^Automated Graph\/[^/]+\/Topics\//.test(p)) {
      const s = spaceOfPath(p)
      if (s) spaces.add(s)
    }
  }
  return [...spaces].sort()
}

export function topicsOfSpace(index: VaultIndex, space: string): Note[] {
  const prefix = `Automated Graph/${space}/Topics/`
  return [...index.notes.values()].filter((n) => n.path.startsWith(prefix))
}

export function configOf(index: VaultIndex, space: string): SpaceConfig {
  const cfg = index.notes.get(`Automated Graph/${space}/_config.md`)?.frontmatter ?? {}
  return {
    confidence_threshold: num(cfg.confidence_threshold, DEFAULT_CONFIG.confidence_threshold),
    weight_importance: num(cfg.weight_importance, DEFAULT_CONFIG.weight_importance),
    weight_unlocks: num(cfg.weight_unlocks, DEFAULT_CONFIG.weight_unlocks),
    weight_interest: num(cfg.weight_interest, DEFAULT_CONFIG.weight_interest),
    review_interval_days: num(cfg.review_interval_days, DEFAULT_CONFIG.review_interval_days),
  }
}

function prereqPaths(note: Note, index: VaultIndex): string[] {
  const raw = note.frontmatter.prerequisites
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const target = item.replace(/\[\[|\]\]/g, '').split('|')[0].split('#')[0].trim()
    const resolved = resolveTarget(target, index.notes, index.nameToPath)
    if (resolved) out.push(resolved)
  }
  return out
}

function confidenceOf(index: VaultIndex, path: string): number {
  return num(index.notes.get(path)?.frontmatter.confidence, 0)
}

function daysSince(dateVal: unknown): number | null {
  if (!dateVal) return null
  const ms = new Date(String(dateVal)).getTime()
  if (Number.isNaN(ms)) return null
  return Math.floor((Date.now() - ms) / 86400000)
}

/** A Date as the vault writes dates: local YYYY-MM-DD, never toISOString(),
 *  which is UTC and would roll over a day early east of Greenwich. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A note's last_reviewed as a plain YYYY-MM-DD, or null.
 *
 *  Defensive about the shape because frontmatter is whatever the YAML parser
 *  made of it: an unquoted date in YAML is a Date, a quoted one is a string,
 *  and a hand-edited vault can hold a full timestamp. Exported so the review
 *  control and the ranking answer "reviewed today?" the same way — the two
 *  disagreeing is what let Next Up recommend a note you could not review. */
export function lastReviewedDay(fm: Record<string, unknown>): string | null {
  const raw = fm.last_reviewed
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return localDay(raw)
  if (typeof raw === 'string') return raw.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  return null
}

export function isReviewedToday(fm: Record<string, unknown>): boolean {
  return lastReviewedDay(fm) === localDay()
}

export interface RankedTopic {
  path: string
  title: string
  confidence: number
  importance: number
  interest: number
  unlocks: number
  score: number
}
export interface LockedTopic {
  path: string
  title: string
  needs: { path: string; title: string }[]
}
export interface ReviewTopic {
  path: string
  title: string
  space: string
  confidence: number
  lastReviewed: string
  daysSince: number | null
}

export interface NextUpResult {
  space: string
  pick: RankedTopic | null
  ranked: RankedTopic[]
  locked: LockedTopic[]
  dueForReview: ReviewTopic[]
}

export function computeNextUp(index: VaultIndex, space: string): NextUpResult {
  const cfg = configOf(index, space)
  const topics = topicsOfSpace(index, space)
  const frontier = topics.filter((p) => p.frontmatter.status === 'frontier')

  const isReady = (p: Note) =>
    prereqPaths(p, index).every((path) => confidenceOf(index, path) >= cfg.confidence_threshold)
  const unlockCount = (p: Note) =>
    frontier.filter((f) => prereqPaths(f, index).includes(p.path)).length

  // What to study next means what to study next — not what scores highest.
  // Two things have to come off the list or the top pick sticks:
  //
  //   Already known. Confidence at or above the threshold is the definition
  //   of "learned" everywhere else in this file; such a topic belongs in
  //   dueForReview, which already collects it, not in the queue of things
  //   still to learn. Nothing filtered these out before, so a topic you had
  //   taken to 4/5 went on outranking everything by importance forever.
  //
  //   Reviewed today. One review per note per day is the rule the reader's
  //   review control enforces, so a note already done today cannot be acted
  //   on — recommending it is telling someone to do something the app will
  //   then refuse. An empty pick ("nothing left today") is the honest answer.
  const available = frontier
    .filter(isReady)
    .filter((p) => num(p.frontmatter.confidence) < cfg.confidence_threshold)
    .filter((p) => !isReviewedToday(p.frontmatter))

  const ranked: RankedTopic[] = available
    .map((p) => {
      const unlocks = unlockCount(p)
      const importance = num(p.frontmatter.importance)
      const interest = num(p.frontmatter.interest)
      return {
        path: p.path,
        title: p.title,
        confidence: num(p.frontmatter.confidence),
        importance,
        interest,
        unlocks,
        score:
          importance * cfg.weight_importance +
          unlocks * cfg.weight_unlocks +
          interest * cfg.weight_interest,
      }
    })
    .sort((a, b) => b.score - a.score)

  const locked: LockedTopic[] = frontier
    .filter((p) => !isReady(p))
    // Same reason as above: a topic you already know is not "locked", it is
    // finished, whatever its prerequisites happen to say.
    .filter((p) => num(p.frontmatter.confidence) < cfg.confidence_threshold)
    .map((p) => ({
      path: p.path,
      title: p.title,
      needs: prereqPaths(p, index)
        .filter((path) => confidenceOf(index, path) < cfg.confidence_threshold)
        .map((path) => ({ path, title: index.notes.get(path)?.title ?? path })),
    }))

  const dueForReview: ReviewTopic[] = topics
    .filter((p) => num(p.frontmatter.confidence) >= cfg.confidence_threshold)
    .map((p) => {
      const d = daysSince(p.frontmatter.last_reviewed)
      return {
        path: p.path,
        title: p.title,
        space,
        confidence: num(p.frontmatter.confidence),
        lastReviewed: p.frontmatter.last_reviewed ? String(p.frontmatter.last_reviewed) : 'never',
        daysSince: d,
      }
    })
    .filter((r) => r.daysSince === null || r.daysSince >= cfg.review_interval_days)
    .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity))

  return { space, pick: ranked[0] ?? null, ranked, locked, dueForReview }
}

export interface TodayPick {
  space: string
  rank: number | '—'
  path: string | null
  title: string
  score: string
  confidence: string
}

export function computeToday(index: VaultIndex): { picks: TodayPick[]; reviews: ReviewTopic[] } {
  const picks: TodayPick[] = []
  const reviews: ReviewTopic[] = []
  for (const space of listSpaces(index)) {
    const r = computeNextUp(index, space)
    if (r.ranked.length) {
      r.ranked.slice(0, 3).forEach((c, i) =>
        picks.push({
          space,
          rank: i + 1,
          path: c.path,
          title: c.title,
          score: c.score.toFixed(1),
          confidence: `${c.confidence}/5`,
        }),
      )
    } else {
      const frontier = topicsOfSpace(index, space).some((p) => p.frontmatter.status === 'frontier')
      if (frontier)
        picks.push({ space, rank: '—', path: null, title: '(nothing ready — see Next Up)', score: '—', confidence: '—' })
    }
    reviews.push(...r.dueForReview)
  }
  return { picks, reviews }
}

export interface FlashcardCandidate {
  space: string
  path: string
  title: string
  confidence: number
  lastReviewed: string
  daysSince: number | null
}

export function computeFlashcards(index: VaultIndex, limit = 10): FlashcardCandidate[] {
  const candidates: FlashcardCandidate[] = []
  for (const space of listSpaces(index)) {
    for (const p of topicsOfSpace(index, space)) {
      const confidence = num(p.frontmatter.confidence)
      if (confidence <= 0) continue
      candidates.push({
        space,
        path: p.path,
        title: p.title,
        confidence,
        lastReviewed: p.frontmatter.last_reviewed ? String(p.frontmatter.last_reviewed) : 'never',
        daysSince: daysSince(p.frontmatter.last_reviewed),
      })
    }
  }
  candidates.sort((a, b) => {
    const da = a.daysSince ?? Infinity
    const db = b.daysSince ?? Infinity
    if (db !== da) return db - da
    return a.confidence - b.confidence
  })
  return candidates.slice(0, limit)
}
