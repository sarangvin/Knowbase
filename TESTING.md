# Base test suite — local vs. hosted parity

This is the checklist used to verify KnowBase after any change. It's a manual QA
spec (no automated test framework is wired up yet), organized so the **hosted**
deployment (GitHub Pages) is checked against the same requirements as **local**
dev (`npm run dev`). Every item here must pass in both environments before
calling a change done — the hosted site has real constraints local dev doesn't
(static-file serving, cross-origin Ollama, no filesystem access), so "works
locally" is not sufficient signal on its own.

Run this after: any change to `src/vault/*`, `src/features/graph/*`,
`src/features/ask-ai/*`, `src/features/sync/*`, or the Vite/deploy config.

**Environments:**
- Local: `npm run dev` → `http://localhost:5190/`
- Hosted: `https://sarangvin.github.io/Knowbase/`

**Last full pass:** 2026-07-08 — both environments green after fixing the graph
freeze/reshuffle bug (see `git log` around that date for the 3-commit sequence).

---

## 1. Boot & data loading

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 1.1 | Onboarding screen renders, no console errors on load | ✅ | ✅ |
| 1.2 | "Explore the demo vault" loads the curated vault (Economics + scaffolding only — **no** personal folders: no `Claude Projects/`, `Sarang's Instagram.md`, `Saru Inst Review.md`, `Rage on Twitter.md`, screenshots) | ✅ | ✅ |
| 1.3 | All vault file requests return 200 (check Network tab / `read_network_requests`) — paths with `&` and spaces (e.g. `Markets & Prices`) must resolve, not 404 | ✅ | ✅ |
| 1.4 | Status bar shows correct note count | ✅ | ✅ |

## 2. Navigation

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 2.1 | File tree expand/collapse folders | ✅ | ✅ |
| 2.2 | Click a note in the tree → opens, breadcrumb updates | ✅ | ✅ |
| 2.3 | Click a resolved `[[wikilink]]` in note body → navigates; unresolved links are visually distinct (red/dim) and don't navigate | ✅ | ✅ |
| 2.4 | Back / Forward buttons and `⌥←` / `⌥→` | ✅ | ✅ |
| 2.5 | Quick switcher (`⌘O`): fuzzy search, Enter opens top result | ✅ | ✅ |
| 2.6 | Command palette (`⌘P`): fuzzy search commands, Enter runs top result (tested: open Graph view) | ✅ | ✅ |

## 3. Reading view

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 3.1 | Frontmatter renders as a properties table (space/status/prerequisites/importance/interest/confidence/last_reviewed) | ✅ | ✅ |
| 3.2 | `prerequisites` wikilinks in properties are clickable | ✅ | ✅ |
| 3.3 | Backlinks panel shows correct count + context snippets for a note with inbound links | ✅ | ✅ |
| 3.4 | Outline panel lists headings; click scrolls to heading | ✅ | ✅ |
| 3.5 | `` ```dataviewjs `` blocks render as native computed dashboards (Next Up / Today / Flashcards), not raw code | ✅ | ✅ |

## 4. Search

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 4.1 | Search panel returns results with correct count | ✅ | ✅ |
| 4.2 | Matched terms highlighted in title/snippet | ✅ | ✅ |
| 4.3 | Keyboard nav (↑/↓) + Enter opens selected result | ✅ | ✅ |

## 5. Graph view

**This is the area with the most historical bugs — check carefully.**

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 5.1 | Whole-vault graph (⌘G): nodes visibly spread out, labels legible and non-overlapping — **not** clumped in the center | ✅ | ✅ |
| 5.2 | Layout renders within ~1s of opening (warmupTicks pre-computes positions; should not take multiple seconds to "settle") | ✅ | ✅ |
| 5.3 | Layout is stable — screenshot at open vs. 3s later should be pixel-identical (no drift, no re-clump) | ✅ | ✅ |
| 5.4 | **Resize the window (or toggle a sidebar) after the graph has settled** — the layout topology must stay the same, just re-framed to the new size. It must **not** reshuffle/re-randomize into a different (possibly worse) layout. This is the regression to watch for if `GraphView.tsx`'s effects are touched. | ✅ | ✅ |
| 5.5 | Click a node → navigates to that note | ✅ | ✅ |
| 5.6 | Hover a node → connected links highlight, unrelated nodes dim | ✅ | ✅ |
| 5.7 | Local graph (right sidebar, per-note) shows the focused note enlarged/highlighted among its neighbors | ✅ | ✅ |

## 6. Editing

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 6.1 | Edit mode (pencil / `⌘E`) opens CodeMirror with markdown syntax highlighting | ✅ | ✅ |
| 6.2 | Demo vault shows "edits save in this browser only" banner; edits persist via IndexedDB overlay across a full page reload | ✅ | ✅ |
| 6.3 | `⌘S` / blur saves; status line reflects Saved/Unsaved | ✅ | ✅ |
| 6.4 | "+ New note": name + folder picker + topic-template toggle; created note opens immediately and appears in the tree | ✅ | ✅ |

## 7. AI features (Ollama)

Requires a local Ollama server. **On hosted**, Ollama must additionally allow
the hosted origin via CORS:
```
OLLAMA_ORIGINS="https://sarangvin.github.io" ollama serve
```
(Local dev works with a plain `ollama serve` since Ollama allows localhost by default.)

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 7.1 | Ask AI panel: disconnected state shows a clear fix — `ollama serve` locally, plus the `OLLAMA_ORIGINS` command **only** when on a non-localhost origin | ✅ | ✅ |
| 7.2 | Disconnected-state code/URL text wraps within the panel — does not overflow/get clipped | ✅ | ✅ |
| 7.3 | Once connected: model picker lists installed models | ✅ | ✅ |
| 7.4 | Ask a question → streams an answer grounded in the open note's content | ✅ | ✅ |
| 7.5 | Answer does **not** contain raw LaTeX (`$...$`, `\text{}`, `\frac{}`) — must be plain Markdown/text, since the renderer doesn't support math notation | ✅ | ✅ |
| 7.6 | "Save to note" appends `Q:`/`A:` to the note's `## Questions` section and bumps `last_reviewed` to today | ✅ | ✅ |
| 7.7 | AI Sync (top bar ↻): scans the vault, correctly finds (a) unanswered `Q:` entries and (b) notes with non-empty `## My Notes`; skips dashboards/templates/Welcome | ✅ | ✅ |
| 7.8 | Running Sync answers each question in place and rewrites `## AI Notes` folding in `## My Notes` content, without dropping existing correct content or existing `[[wikilinks]]` | ✅ | ✅ |
| 7.9 | Sync modal shows live per-task status (pending → running → done/error) and a final `N/M updated` summary | ✅ | ✅ |

## 8. Console / network hygiene

| # | Check | Local | Hosted |
|---|---|:---:|:---:|
| 8.1 | Zero console errors across a full pass of sections 1–7 | ✅ | ✅ |
| 8.2 | Zero failed (4xx/5xx) network requests | ✅ | ✅ |

---

## Known non-goals / acceptable gaps

- **Graph auto-fit isn't pixel-perfect** — occasionally a node or two sits near
  the viewport edge after the initial fit. Acceptable since the graph is
  pannable/zoomable; only *clumping* (5.1) and *reshuffling on resize* (5.4)
  are treated as bugs.
- **"Open my own folder"** (File System Access API) is not covered by this
  checklist yet — Chromium-only, needs a real local folder to test against.
- **Flashcards quiz-me mode** (model asks, grades the user's typed answer,
  adjusts `confidence`) does not exist yet — AI Sync only *answers* the user's
  questions, it doesn't quiz them. Tracked as a follow-up, not a regression.

## How to re-run this checklist quickly

1. `npm run build && git push` (or just `npm run dev` for local-only changes).
2. Wait for the GitHub Actions deploy to finish: `gh run list --limit 1`.
3. Local: use the `preview_*` tools against `npm run dev`.
4. Hosted: use the `claude-in-chrome` tools (`browser_batch`, `find`,
   `read_console_messages`, `read_network_requests`, `javascript_tool`) against
   the live URL — this is what actually caught the graph bugs; the local
   preview harness alone did not reliably reproduce them.
5. For section 7, make sure Ollama is running with the right `OLLAMA_ORIGINS`
   for whichever environment you're testing.
