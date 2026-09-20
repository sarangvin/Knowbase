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
  /** Set when the pick came from the review list because no new topic was
   *  available — the card says "review" rather than quoting a score of 0. */
  isReview?: boolean
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
  interest: number
  lastReviewed: string
  daysSince: number | null
}

export interface NextUpResult {
  space: string
  pick: RankedTopic | null
  ranked: RankedTopic[]
  locked: LockedTopic[]
  /** Every topic opened at least once, most worth revisiting first. */
  review: ReviewTopic[]
}

export function computeNextUp(index: VaultIndex, space: string): NextUpResult {
  const cfg = configOf(index, space)
  const topics = topicsOfSpace(index, space)
  const frontier = topics.filter((p) => p.frontmatter.status === 'frontier')

  const isReady = (p: Note) =>
    prereqPaths(p, index).every((path) => confidenceOf(index, path) >= cfg.confidence_threshold)
  const unlockCount = (p: Note) =>
    frontier.filter((f) => prereqPaths(f, index).includes(p.path)).length

  // Two lists, split on one question: have you opened this before?
  //
  // Frontier is new material only — topics with no last_reviewed at all.
  // Anything you have touched has a history, and a history is what the
  // review list is ordered by; mixing the two put a topic you had taken to
  // 4/5 at the top of "what to learn next" on importance alone, where it
  // outranked everything indefinitely.
  const unopened = frontier.filter(isReady).filter((p) => !lastReviewedDay(p.frontmatter))

  const ranked: RankedTopic[] = unopened
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
    // Locked is the waiting room for new material. A topic you have already
    // opened is in the review list instead — each topic appears in exactly
    // one of the three, which is what makes the page readable.
    .filter((p) => !lastReviewedDay(p.frontmatter))
    .map((p) => ({
      path: p.path,
      title: p.title,
      needs: prereqPaths(p, index)
        .filter((path) => confidenceOf(index, path) < cfg.confidence_threshold)
        .map((path) => ({ path, title: index.notes.get(path)?.title ?? path })),
    }))

  // Everything you have opened at least once, whatever its confidence.
  // Previously this list required confidence >= threshold *and* 30 days
  // elapsed, so a topic you had read once and scored 1/5 appeared nowhere
  // at all — not in the frontier, not here. Half-learned material falling
  // out of the system is the worst failure this page can have.
  const review: ReviewTopic[] = topics
    .filter((p) => !!lastReviewedDay(p.frontmatter))
    .map((p) => ({
      path: p.path,
      title: p.title,
      space,
      confidence: num(p.frontmatter.confidence),
      interest: num(p.frontmatter.interest),
      lastReviewed: lastReviewedDay(p.frontmatter) ?? 'never',
      daysSince: daysSince(p.frontmatter.last_reviewed),
    }))
    // Want-to-know first, then least-known, then longest-neglected. A
    // lexicographic sort rather than a blended score: the order has to be
    // explainable from the columns on screen, and a weighted number is not.
    .sort(
      (a, b) =>
        b.interest - a.interest ||
        a.confidence - b.confidence ||
        a.lastReviewed.localeCompare(b.lastReviewed),
    )

  // Nothing new left does not mean nothing to do. Fall back to the top of
  // the review list, skipping anything already reviewed today — one review
  // per note per day is enforced in the reader, and recommending a note it
  // will refuse is how this page lost the user's trust the first time.
  const fallback = review.find((r) => r.daysSince !== 0 && r.lastReviewed !== localDay())
  const pick: RankedTopic | null =
    ranked[0] ??
    (fallback
      ? {
          path: fallback.path,
          title: fallback.title,
          confidence: fallback.confidence,
          importance: num(index.notes.get(fallback.path)?.frontmatter.importance),
          interest: fallback.interest,
          unlocks: 0,
          score: 0,
          isReview: true,
        }
      : null)

  return { space, pick, ranked, locked, review }
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
    reviews.push(...r.review)
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
