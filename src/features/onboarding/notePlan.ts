// Pure, network-free note-building for the topic-onboarding flow: sanitizing
// generated titles into safe paths/wikilinks, disambiguating a new space name
// against existing spaces, building topic-note and Next Up.md content, and
// repairing the small prerequisite graph (breaking cycles, guaranteeing at
// least one prerequisite-free "foundational" topic).
import { listSpaces } from '../automated-graph/engine'
import type { VaultIndex } from '../../vault/types'

export interface Subtopic {
  title: string
  summary: string
  /** Titles of OTHER subtopics in the same batch — must resolve in-batch only. */
  prerequisites: string[]
  importance: number
  interest: number
}

// Prerequisite titles get embedded as `[[Title]]` wikilinks in frontmatter,
// and engine.ts's prereqPaths() strips [ ] | # when resolving — a generated
// title containing any of those would silently corrupt prerequisite
// resolution, not just look ugly in a path. Stricter than generic
// filename-safety on purpose.
// eslint-disable-next-line no-control-regex -- intentionally stripping control chars from generated titles
const DISALLOWED_CHARS = /[/\\:*?"<>[\]|#\x00-\x1f]/g

export function sanitizeSegment(raw: string, maxLen: number, fallback: string): string {
  let s = raw.replace(DISALLOWED_CHARS, '').replace(/\s+/g, ' ').trim()
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen)
    const lastSpace = cut.lastIndexOf(' ')
    s = (lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut).trim()
  }
  return s || fallback
}

/** Titles are validated unique before sanitizing, but stripping characters
 * could still collide two distinct titles onto the same path (e.g. "A/B" and
 * "A B" both sanitize to "A B") — number the later ones so no subtopic note
 * silently overwrites another. */
export function dedupeSegments(rawTitles: string[]): string[] {
  const seen = new Map<string, number>()
  return rawTitles.map((raw) => {
    const base = sanitizeSegment(raw, 60, 'Topic')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}

/** Case-insensitive collision check against every existing space (personal + global-origin). */
export function disambiguateSpace(name: string, index: VaultIndex | null): string {
  const existing = new Set((index ? listSpaces(index) : []).map((s) => s.toLowerCase()))
  if (!existing.has(name.toLowerCase())) return name
  let n = 2
  while (existing.has(`${name} ${n}`.toLowerCase())) n++
  return `${name} ${n}`
}

/** DFS cycle detection over the small (<=5 node) title graph. On a cycle,
 * clears prerequisites on the lowest-importance node in it and re-checks —
 * bounded by subtopics.length iterations, can't loop forever. */
export function breakCycles(subtopics: Subtopic[]): Subtopic[] {
  const result = subtopics.map((s) => ({ ...s, prerequisites: [...s.prerequisites] }))
  const byTitle = new Map(result.map((s) => [s.title, s]))

  function findCycle(): Subtopic[] | null {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    let cyclePath: string[] | null = null

    function visit(title: string, path: string[]): void {
      if (cyclePath || visited.has(title)) return
      if (visiting.has(title)) {
        cyclePath = path.slice(path.indexOf(title))
        return
      }
      visiting.add(title)
      for (const prereq of byTitle.get(title)?.prerequisites ?? []) {
        visit(prereq, [...path, title])
        if (cyclePath) return
      }
      visiting.delete(title)
      visited.add(title)
    }

    for (const s of result) {
      visit(s.title, [])
      if (cyclePath) break
    }
    return cyclePath ? (cyclePath as string[]).map((t) => byTitle.get(t)).filter((s): s is Subtopic => !!s) : null
  }

  for (let i = 0; i < result.length; i++) {
    const cycle = findCycle()
    if (!cycle || cycle.length === 0) break
    const weakest = cycle.reduce((a, b) => (a.importance <= b.importance ? a : b))
    weakest.prerequisites = []
  }
  return result
}

/** Backstop: cycle-breaking alone should already guarantee this, but force it if not. */
export function ensureFoundational(subtopics: Subtopic[]): Subtopic[] {
  if (subtopics.some((s) => s.prerequisites.length === 0)) return subtopics
  const weakest = subtopics.reduce((a, b) => (a.importance <= b.importance ? a : b))
  return subtopics.map((s) => (s === weakest ? { ...s, prerequisites: [] } : s))
}

/** Generated prose is untrusted markdown dropped into a structured note. Two
 * things would actually corrupt the file rather than merely look wrong:
 * a line of `---` (parsed as frontmatter by Obsidian and by this app's own
 * reader when it lands near the top), and an `h1`/`h2` heading, which would
 * invent a section alongside the fixed AI Notes / My Notes / Questions
 * skeleton the rest of the app relies on. Demote rather than strip, so the
 * author's structure survives in a form that can't collide. */
function sanitizeGeneratedMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return '' // horizontal rule / frontmatter fence
      return line.replace(/^(\s*)(#{1,2})\s+/, '$1### ') // h1/h2 → h3, below our own sections
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** For values rendered as a single list item. Block-level demotion is wrong
 * here: "### x" inside "- ### x" still reads as markup, and a newline would
 * break out of the bullet entirely. Strip leading block markers and flatten
 * to one line instead. */
function sanitizeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    // Rule first: "---" would otherwise lose a single dash to the bullet
    // pattern below and survive as "--".
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*/, '')
    .replace(/^\s*(?:[#>]+|[-*+]|\d+\.)\s*/, '')
    .trim()
}

export interface TopicNoteBody {
  overview: string
  keyPoints: string[]
  questions: string[]
}

/** Matches the topicTemplate shape from features/explorer/NewNoteModal.tsx —
 * confidence/status/last_reviewed are always hardcoded here, never trusted
 * from generated data, since "brand new" is a product invariant.
 *
 * `body` is the LLM-drafted first pass; omit or pass null to fall back to the
 * one-line summary. */
export function buildTopicNote(
  title: string,
  s: Subtopic,
  body?: TopicNoteBody | null,
  opts?: { pending?: boolean },
): string {
  const prereqLine =
    s.prerequisites.length === 0
      ? 'prerequisites: []'
      : `prerequisites:\n${s.prerequisites.map((p) => `  - "[[${p}]]"`).join('\n')}`
  // Falls back to the bare summary when note generation failed or was
  // skipped, so a note is never empty and onboarding never depends on the
  // second round of LLM calls succeeding.
  const aiNotes = body
    ? [
        sanitizeGeneratedMarkdown(body.overview),
        body.keyPoints.length
          ? '\n**Key points**\n\n' + body.keyPoints.map((p) => `- ${sanitizeInline(p)}`).join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : opts?.pending
      // Written into the note itself rather than surfaced as app chrome: the
      // reader finds out a fuller draft is coming at the moment they open the
      // note and see only a sentence, which is exactly when the question
      // occurs to them. It is replaced wholesale when the draft lands, and
      // rewritten without this line if drafting fails.
      ? `${s.summary.trim()}\n\n_Writing a fuller draft of this note…_`
      : s.summary.trim()

  // Left empty deliberately: a model asked for "useful links" produces
  // confident, plausible URLs that frequently 404 or point somewhere
  // unrelated. An empty section the reader fills in beats fabricated sources.
  const questions = body?.questions.length
    ? body.questions.map((q) => `- ${sanitizeInline(q)}`).join('\n') + '\n'
    : ''

  return `---
space:
status: frontier
${prereqLine}
importance: ${s.importance}
interest: ${s.interest}
confidence: 0
last_reviewed:
---

# ${title}

## AI Notes

${aiNotes}

## Useful Links


## My Notes


## Questions

${questions}`
}

/** Adapted from the reference public/vault/Automated Graph/Economics/Next Up.md
 * — same algorithm/structure (Dataview-compatible, portable to real Obsidian),
 * space name substituted into the folder/config paths. register.tsx renders
 * this app's own React NextUp component for any note named "Next Up.md"
 * regardless of the block's actual content, but the block stays faithful so
 * the note still works if exported to real Obsidian. */
export function buildNextUpNote(space: string): string {
  const lines = [
    `# Next Up — ${space}`,
    '',
    'Requires the Dataview plugin (with JavaScript queries enabled). Tunable parameters live in [[_config]].',
    '',
    '```dataviewjs',
    `const TOPICS_FOLDER = '"Automated Graph/${space}/Topics"';`,
    '',
    `const config = dv.page("Automated Graph/${space}/_config") ?? {};`,
    'const CONF_THRESHOLD = config.confidence_threshold ?? 3;',
    'const W_IMPORTANCE = config.weight_importance ?? 1;',
    'const W_UNLOCKS = config.weight_unlocks ?? 2;',
    'const W_INTEREST = config.weight_interest ?? 0.5;',
    'const REVIEW_DAYS = config.review_interval_days ?? 30;',
    '',
    'const pages = dv.pages(TOPICS_FOLDER);',
    'const pageByPath = new Map(pages.array().map(p => [p.file.path, p]));',
    'const frontier = pages.where(p => p.status === "frontier");',
    '',
    'function toMillis(d) {',
    '  if (!d) return null;',
    '  if (typeof d.toMillis === "function") return d.toMillis();',
    '  const parsed = new Date(d);',
    '  return isNaN(parsed.getTime()) ? null : parsed.getTime();',
    '}',
    '',
    'function prereqPaths(p) {',
    '  return (p.prerequisites ?? []).map(pr => pr.path);',
    '}',
    '',
    'function confidenceOf(path) {',
    '  return pageByPath.get(path)?.confidence ?? 0;',
    '}',
    '',
    'function isReady(p) {',
    '  return prereqPaths(p).every(path => confidenceOf(path) >= CONF_THRESHOLD);',
    '}',
    '',
    'function unlockCount(p) {',
    '  return frontier.where(f => prereqPaths(f).includes(p.file.path)).length;',
    '}',
    '',
    'const ranked = frontier',
    '  .where(isReady)',
    '  .map(p => {',
    '    const unlocks = unlockCount(p);',
    '    const score = (p.importance ?? 0) * W_IMPORTANCE + unlocks * W_UNLOCKS + (p.interest ?? 0) * W_INTEREST;',
    '    return { page: p, unlocks, score };',
    '  })',
    "  .sort(c => c.score, 'desc');",
    '',
    'if (ranked.length) {',
    '  const top = ranked[0];',
    '  dv.header(3, "Pick: " + top.page.file.link);',
    '  dv.paragraph(`Score **${top.score.toFixed(1)}** — importance ${top.page.importance}, unlocks ${top.unlocks} other topic(s), interest ${top.page.interest}, confidence ${top.page.confidence ?? 0}/5 (prerequisites need >= ${CONF_THRESHOLD}/5, met).`);',
    '} else {',
    '  dv.paragraph("No frontier topics are ready yet — raise confidence on a prerequisite (study it, then update its `confidence`), or lower `confidence_threshold` in `_config.md`.");',
    '}',
    '',
    'dv.header(4, "Frontier (ready now)");',
    'dv.table(',
    '  ["Topic", "Confidence", "Importance", "Unlocks", "Interest", "Score"],',
    '  ranked.array().map(c => [c.page.file.link, `${c.page.confidence ?? 0}/5`, c.page.importance, c.unlocks, c.page.interest, c.score.toFixed(1)])',
    ');',
    '',
    'const notReady = frontier.where(p => !isReady(p));',
    'if (notReady.length) {',
    '  dv.header(4, "Locked (prerequisites not yet confident enough)");',
    '  dv.table(',
    '    ["Topic", "Needs"],',
    '    notReady.array().map(p => [',
    '      p.file.link,',
    '      prereqPaths(p)',
    '        .filter(path => confidenceOf(path) < CONF_THRESHOLD)',
    '        .map(path => pageByPath.get(path)?.file?.link ?? path)',
    '        .join(", ")',
    '    ])',
    '  );',
    '}',
    '',
    'const reviewDue = pages',
    '  .where(p => (p.confidence ?? 0) >= CONF_THRESHOLD)',
    '  .map(p => {',
    '    const lastMs = toMillis(p.last_reviewed);',
    '    const daysSince = lastMs === null ? null : Math.floor((Date.now() - lastMs) / 86400000);',
    '    return { page: p, daysSince };',
    '  })',
    '  .where(c => c.daysSince === null || c.daysSince >= REVIEW_DAYS)',
    "  .sort(c => (c.daysSince ?? Infinity), 'desc');",
    '',
    'if (reviewDue.length) {',
    '  dv.header(4, "Due for review");',
    '  dv.table(',
    '    ["Topic", "Confidence", "Last reviewed", "Days since"],',
    '    reviewDue.array().map(c => [',
    '      c.page.file.link,',
    '      `${c.page.confidence ?? 0}/5`,',
    '      c.page.last_reviewed ?? "never",',
    '      c.daysSince ?? "—"',
    '    ])',
    '  );',
    '}',
    '```',
    '',
    '## How this works',
    '- **Confidence** (0-5, set on each topic note) is the source of truth for "how well do I know this". A prerequisite is considered *met* once its confidence reaches `confidence_threshold` in [[_config]].',
    '- **Frontier (ready now)** — topics whose prerequisites are met, ranked by `score = importance * weight_importance + unlocks * weight_unlocks + interest * weight_interest`. Leverage (unlocks) is weighted highest by default.',
    '- **Locked** — frontier topics still waiting on a prerequisite to reach the confidence threshold.',
    "- **Due for review** — topics you've already learned (confidence >= threshold) that haven't been touched in `review_interval_days`. Update `last_reviewed` (and re-confirm/adjust `confidence`) after you review one.",
    '',
    'To progress a topic: study it, update its `confidence` and `last_reviewed` in frontmatter, and the rankings recalculate automatically.',
    '',
  ]
  return lines.join('\n')
}
