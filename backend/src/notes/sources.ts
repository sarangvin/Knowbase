// Sources for a note: links whose own text backs up what the note says.
//
// Real search grounding (Gemini with Google Search) is not available on the
// free tier for the models this key can use, so this finds sources without
// it, and spends ONE model call per note doing so. Everything except the
// final judgement is deterministic:
//
//   1. Claims — the note's own "Key points" list, which the drafter writes as
//      one checkable sentence each. A note without one falls back to its
//      longest sentences.
//   2. Candidates — Wikipedia's search API (free, no key, and it only
//      returns pages that exist), plus the outside sources those Wikipedia
//      articles cite: standards bodies, official docs, publications. Nothing
//      here comes from a model's memory, so nothing here is invented.
//   3. Fetch — every candidate is loaded by the server; anything that does
//      not load, is not readable text, or points inside a private network is
//      dropped.
//   4. Match — each claim is paired with the pages whose sentences share the
//      most of its words, and the best few sentences of each are kept.
//   5. Judge — the one model call: for every pair, does a sentence on the
//      page support the claim, and which one. It answers with the sentence's
//      number, not its text, so the quote shown is always exactly what the
//      page says.
//
// The result is written into the note's "Useful Links" section inside a
// marked block, so finding sources again replaces only what this wrote and
// never the links a reader added by hand.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { meteredGeminiCall } from '../llm/meter.js'

export interface FoundSource {
  url: string
  title: string
  claim: string
  /** The page's own sentence that supports the claim, verbatim. */
  quote: string
  strength: 'supports' | 'partly'
}

export interface SourcesResult {
  claims: string[]
  sources: FoundSource[]
  /** Pages fetched and readable, for reporting. */
  pagesRead: number
  candidates: number
}

const UA = 'RabbitholeSources/1.0 (+https://rabbithole-topaz.vercel.app)'
const MAX_SOURCES = 5
const MAX_CLAIMS = 5

// ── 1. claims ─────────────────────────────────────────────────────────────

function aiNotesOf(raw: string): string {
  const m = raw.match(/^##\s+AI Notes\s*$/im)
  if (!m || m.index == null) return ''
  const rest = raw.slice(m.index + m[0].length)
  const next = rest.search(/^##\s+/m)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

function plain(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function claimsOf(raw: string): string[] {
  const ai = aiNotesOf(raw)
  const kp = ai.match(/\*\*Key points\*\*\s*\n([\s\S]*)$/i)
  if (kp) {
    const bullets = kp[1]
      .split('\n')
      .map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1])
      .filter((x): x is string => !!x)
      .map(plain)
      .filter((c) => c.length >= 25)
    if (bullets.length) return bullets.slice(0, MAX_CLAIMS)
  }
  // No key points: the longest sentences of the prose, which in practice are
  // the ones carrying a definite claim rather than a transition.
  return sentencesOf(plain(ai))
    .filter((s) => s.length >= 50 && s.length <= 300)
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_CLAIMS)
}

// ── words ─────────────────────────────────────────────────────────────────

const STOP = new Set(
  'about above after again against also although among another because been before being between both cannot could does doing during each either every from further have having here into itself just more most much must neither other others over same should since some such than that their them then there these they this those through under until upon very what when where which while whom whose will with within without would your also often many like used uses using make makes made only even well what'.split(
    ' ',
  ),
)

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w))
}

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, '')
}

/** Sentences, never across a line break: a heading or a menu item on the
 *  line above is not part of the sentence below it. */
function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 500 && /[.!?]["”)]?$/.test(s))
}

// ── 2. candidates ─────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8_000) })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

async function wikiSearch(query: string, limit: number): Promise<string[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`
  const d = await getJson<{ query?: { search?: { title: string }[] } }>(url)
  return (d?.query?.search ?? []).map((r) => r.title)
}

async function wikiExternalLinks(title: string): Promise<string[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&ellimit=300&format=json&titles=${encodeURIComponent(title)}`
  const d = await getJson<{ query?: { pages?: Record<string, { extlinks?: { '*': string }[] }> } }>(url)
  const pages = Object.values(d?.query?.pages ?? {})
  return pages.flatMap((p) => (p.extlinks ?? []).map((l) => l['*']))
}

/** A Wikipedia article as plain text, from the API rather than the page:
 *  the page's HTML carries menus, infoboxes and citation markers that end up
 *  glued to the sentences around them. */
async function wikiPage(title: string): Promise<Page | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=${encodeURIComponent(title)}`
  const d = await getJson<{ query?: { pages?: Record<string, { title?: string; extract?: string }> } }>(url)
  const page = Object.values(d?.query?.pages ?? {})[0]
  if (!page?.extract || page.extract.length < 400) return null
  // Section headings come through as "== Heading ==" lines.
  const text = page.extract.replace(/^=+.*=+$/gm, '').replace(/\n{2,}/g, '\n')
  return { url: wikiUrl(page.title ?? title), title: `${page.title ?? title} (Wikipedia)`, text }
}

const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

/** Cited links worth trying: not archives, not other wikis, not book or
 *  identifier lookups, and with a path that shares words with the topic. */
function pickCited(links: string[], topicWords: Set<string>, n: number): string[] {
  const skip = /(wikipedia\.org|wikimedia|wikidata|archive\.org|archive\.today|books\.google|doi\.org|worldcat|jstor|ncbi\.nlm\.nih\.gov\/pmc\/articles\/PMC\d+\/?$|\.pdf($|\?))/i
  const scored = links
    .filter((u) => /^https?:\/\//.test(u) && !skip.test(u))
    .map((u) => {
      const path = u.toLowerCase().replace(/^https?:\/\/[^/]+/, '')
      const hits = [...topicWords].filter((w) => path.includes(w)).length
      return { u, hits }
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  const seenHost = new Set<string>()
  const out: string[] = []
  for (const { u } of scored) {
    const host = new URL(u).hostname
    if (seenHost.has(host)) continue
    seenHost.add(host)
    out.push(u)
    if (out.length === n) break
  }
  return out
}

// ── 3. fetch, safely ──────────────────────────────────────────────────────

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v === '::'
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/** Public http(s) only. Candidates come from Wikipedia's citations, which
 *  anyone can edit, so a link aimed at this server's own network is not a
 *  hypothetical. Checked on every redirect hop, not just the first URL. */
async function publicUrl(raw: string): Promise<URL | null> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return null
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return null
  } catch {
    return null
  }
  return u
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function htmlToText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim())
  const body = html
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decode(body)
    .replace(/\[\d+\]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return { title, text }
}

interface Page {
  url: string
  title: string
  text: string
}

async function fetchPage(start: string): Promise<Page | null> {
  let url = start
  for (let hop = 0; hop < 4; hop++) {
    const safe = await publicUrl(url)
    if (!safe) return null
    let res: Response
    try {
      res = await fetch(safe, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,text/plain;q=0.9' },
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      return null
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      url = new URL(loc, safe).toString()
      continue
    }
    if (!res.ok || !res.body) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain/i.test(type)) return null
    // Capped: a page is read for a few sentences, not archived.
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
      if (size > 2_000_000) {
        await reader.cancel()
        break
      }
    }
    const html = Buffer.concat(chunks).toString('utf8')
    const { title, text } = /text\/plain/i.test(type) ? { title: '', text: html } : htmlToText(html)
    if (text.length < 400) return null
    return { url: safe.toString(), title: title || safe.hostname, text }
  }
  return null
}

// ── 4. match ──────────────────────────────────────────────────────────────

/** The page's sentences that share the most words with the claim. */
function bestSentences(claim: string, page: Page, n: number): { score: number; sentences: string[] } {
  const want = new Set(words(claim).map(stem))
  if (!want.size) return { score: 0, sentences: [] }
  const ranked = sentencesOf(page.text)
    .map((s) => {
      const have = new Set(words(s).map(stem))
      let hit = 0
      for (const w of want) if (have.has(w)) hit++
      return { s, score: hit / want.size }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
  return { score: ranked[0]?.score ?? 0, sentences: ranked.map((r) => r.s) }
}

// ── 5. judge (the one model call) ─────────────────────────────────────────

const JUDGE = `You check whether web pages support claims from a study note.

For each item you get a claim and numbered sentences taken from one web page.
Decide whether any ONE of those sentences, read on its own, states the same fact as the claim.

Respond with ONLY a JSON array, one object per item, no prose and no code fences:
[{"id": number, "verdict": "supports" | "partly" | "no", "sentence": number}]

- "supports": a sentence states the claim's main fact. "sentence" is its number.
- "partly": a sentence states part of it, or the same idea more generally. "sentence" is its number.
- "no": none of them do. Use "sentence": 0.
- Judge only from the sentences given. Do not use outside knowledge. When in doubt, say "no".`

interface Pair {
  id: number
  claim: string
  page: Page
  sentences: string[]
  score: number
}

function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

// ── putting it together ───────────────────────────────────────────────────

export async function findSources(
  noteTitle: string,
  raw: string,
  opts: { space?: string; userId?: string; models?: string[]; timeoutMs?: number } = {},
): Promise<SourcesResult> {
  const claims = claimsOf(raw)
  const empty: SourcesResult = { claims, sources: [], pagesRead: 0, candidates: 0 }
  if (!claims.length) return empty

  // Candidates. The title alone can land on the wrong meaning ("Bidding"),
  // so it is also searched with the collection's name for context.
  // Each claim is searched too, by its own most distinctive words: a note's
  // claims range wider than its title.
  const claimQuery = (c: string) => [...new Set(words(c))].sort((a, b) => b.length - a.length).slice(0, 5).join(' ')
  const queries = [
    noteTitle,
    opts.space ? `${noteTitle} ${opts.space}` : null,
    ...claims.map((c) => `${claimQuery(c)} ${opts.space ?? ''}`.trim()),
  ].filter((q): q is string => !!q)
  const results = await Promise.all(queries.map((q, i) => wikiSearch(q, i < 2 ? 3 : 1)))
  const titles = [...new Set(results.flat())].slice(0, 8)
  const topicWords = new Set([...words(noteTitle), ...words(opts.space ?? '')].map(stem).filter((w) => w.length >= 4))
  const cited = (await Promise.all(titles.slice(0, 3).map(wikiExternalLinks))).flat()
  const external = pickCited(cited, topicWords, 8)

  const pages = (
    await Promise.all([...titles.map(wikiPage), ...external.map(fetchPage)])
  ).filter((p): p is Page => !!p)
  const candidates = [...titles, ...external]
  const out: SourcesResult = { claims, sources: [], pagesRead: pages.length, candidates: candidates.length }
  if (!pages.length) return out

  // Each claim with its three best-matching pages, then the whole set judged
  // in one call. A pair needs a quarter of the claim's words in one
  // sentence on the page to be worth asking about at all.
  const pairs: Pair[] = []
  for (const claim of claims) {
    const ranked = pages
      .map((page) => ({ page, ...bestSentences(claim, page, 6) }))
      .filter((x) => x.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    for (const r of ranked) pairs.push({ id: pairs.length + 1, claim, page: r.page, sentences: r.sentences, score: r.score })
  }
  if (!pairs.length) return out

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('No model key configured.')
  const user = pairs
    .map(
      (p) =>
        `Item ${p.id}\nClaim: ${p.claim}\nPage: ${p.page.title}\n` +
        p.sentences.map((s, i) => `  ${i + 1}. ${s.slice(0, 400)}`).join('\n'),
    )
    .join('\n\n')
  const reply = await meteredGeminiCall(apiKey, JUDGE, user, {
    userId: opts.userId,
    source: 'find-sources',
    models: opts.models,
    timeoutMs: opts.timeoutMs,
  })
  let verdicts: { id?: unknown; verdict?: unknown; sentence?: unknown }[] = []
  try {
    const parsed = JSON.parse(stripFence(reply))
    verdicts = Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error('The model returned something unreadable. Try again in a moment.')
  }

  const judged: (FoundSource & { score: number })[] = []
  for (const v of verdicts) {
    const pair = pairs.find((p) => p.id === v.id)
    if (!pair || (v.verdict !== 'supports' && v.verdict !== 'partly')) continue
    // "Partly" is kept only when the sentence also shares 40% of the
    // claim's words. Below that it was a page about something next door that
    // mentioned the subject in passing — a DSP explainer offered as the
    // source for a claim about SSPs.
    if (v.verdict === 'partly' && pair.score < 0.4) continue
    const quote = typeof v.sentence === 'number' ? pair.sentences[v.sentence - 1] : undefined
    if (!quote) continue
    judged.push({ url: pair.page.url, title: pair.page.title, claim: pair.claim, quote, strength: v.verdict, score: pair.score })
  }

  // Strongest first, one source per claim before any claim gets a second,
  // and no page twice.
  judged.sort((a, b) => (a.strength === b.strength ? b.score - a.score : a.strength === 'supports' ? -1 : 1))
  const usedUrl = new Set<string>()
  const usedClaim = new Set<string>()
  for (const pass of [true, false]) {
    for (const j of judged) {
      if (out.sources.length === MAX_SOURCES) break
      if (usedUrl.has(j.url) || (pass && usedClaim.has(j.claim))) continue
      usedUrl.add(j.url)
      usedClaim.add(j.claim)
      out.sources.push({ url: j.url, title: j.title, claim: j.claim, quote: j.quote, strength: j.strength })
    }
  }
  return out
}

// ── writing into the note ─────────────────────────────────────────────────

const OPEN = '<!-- rabbithole:sources v1'
const CLOSE = '<!-- /rabbithole:sources -->'
const BLOCK_RE = /<!-- rabbithole:sources v1[^\n]*-->\n[\s\S]*?<!-- \/rabbithole:sources -->\n?/

/** Has this note had sources found for it already. */
export function hasSourcesBlock(raw: string): boolean {
  return raw.includes(OPEN)
}

/** The day (YYYY-MM-DD, UTC) this note's sources were last checked, from
 *  the block's own marker. Null if it has none. */
export function sourcesCheckedOn(raw: string): string | null {
  return raw.match(/<!-- rabbithole:sources v1 checked (\d{4}-\d{2}-\d{2}) -->/)?.[1] ?? null
}

function cleanTitle(t: string): string {
  return t.replace(/\s+[-–—|]\s+Wikipedia$/i, ' (Wikipedia)').replace(/[[\]]/g, '').trim().slice(0, 140)
}

export function sourcesBlock(sources: FoundSource[], day: string): string {
  const items = sources.map((s) => {
    const label = s.strength === 'partly' ? 'Partly supports' : 'Supports'
    return `- [${cleanTitle(s.title)}](${s.url}) — ${label}: ${s.claim}\n  > "${s.quote.replace(/\s+/g, ' ')}"`
  })
  return `${OPEN} checked ${day} -->\n${items.join('\n')}\n${CLOSE}\n`
}

/** Put the block at the top of "Useful Links", replacing an earlier one and
 *  leaving anything the reader wrote there alone. A note without the section
 *  gets one, right after "AI Notes". */
export function writeSources(raw: string, sources: FoundSource[], day: string): string {
  const block = sources.length ? sourcesBlock(sources, day) : ''
  if (BLOCK_RE.test(raw)) return raw.replace(BLOCK_RE, block)
  if (!block) return raw
  const heading = raw.match(/^##[ \t]+Useful Links[ \t]*\n/im)
  if (heading && heading.index != null) {
    const at = heading.index + heading[0].length
    return `${raw.slice(0, at)}\n${block}${raw.slice(at).replace(/^\n+/, '\n')}`
  }
  const next = raw.match(/^##[ \t]+AI Notes[ \t]*\n[\s\S]*?(?=^##[ \t]+)/m)
  if (next && next.index != null) {
    const at = next.index + next[0].length
    return `${raw.slice(0, at)}## Useful Links\n\n${block}\n${raw.slice(at)}`
  }
  return `${raw.replace(/\s+$/, '')}\n\n## Useful Links\n\n${block}`
}
