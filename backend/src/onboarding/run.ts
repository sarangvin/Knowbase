// "Make this person a space", start to finish, on the server.
//
// This is the whole of what TopicOnboarding.tsx used to do in the browser
// while the user watched a spinner: check the corpus, generate a plan, draft
// the note they will land on, write the space, then finish the remaining
// drafts. Every step of it is now behind the response, so the user is in the
// app — browsing the demo space — for all of it.
//
// Why it moved rather than being made faster: the old flow's floor was one
// model call the user had to sit through, and there is no version of "generate
// a curriculum" that is fast enough to wait for. The wait was never the
// problem to optimise; it was the problem to remove.
//
// Progress is written to onboarding_jobs as it goes, because once nobody is
// watching a spinner the only way to tell someone their space is ready is to
// have recorded that it is.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, onboardingJobs } from '../db/schema.js'
import { DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { generateLearningPlan } from './plan.js'
import { draftOne } from './draftNote.js'
import { buildTopicNote, buildNextUpNote, disambiguateSpace, dedupeSegments } from './notePlan.js'
import {
  SPACE_ROOT,
  getOrCreatePersonalVaultId,
  listUserSpaces,
  findLibrarySpaceFor,
  adoptSpaceInto,
  contributeToLibrary,
} from '../vault/spaces.js'
import { logUsageEvent } from '../usage/logEvent.js'

type JobPatch = Partial<{
  status: string
  space: string
  openPath: string
  error: string | null
  notesTotal: number
  notesDrafted: number
}>

async function patchJob(userId: string, patch: JobPatch): Promise<void> {
  await db
    .update(onboardingJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(onboardingJobs.userId, userId))
}

/** Writes the note only if it still holds exactly the text we created it with.
 *  Anything else is the user's own writing — they have had the space open the
 *  whole time this was running, so this is a live race, not a theoretical one. */
async function replaceIfUntouched(
  vaultId: string,
  path: string,
  placeholder: string,
  content: string,
): Promise<boolean> {
  const existing = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, path)))
    .limit(1)
  if (!existing[0] || existing[0].content !== placeholder) return false
  await db
    .update(notes)
    .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, path)))
  return true
}

/**
 * Runs to completion or records why it couldn't. Never throws: the only caller
 * is a fire-and-forget waitUntil, so an escaping error would be a job stuck on
 * 'running' forever and a user staring at a banner that never resolves.
 */
export async function runOnboarding(userId: string, topic: string): Promise<void> {
  try {
    const vaultId = await getOrCreatePersonalVaultId(userId)

    // 1. The corpus first. Someone may already have written this topic, and
    //    copying it is instant and free where generating is ~6 model calls.
    const existingSpace = await findLibrarySpaceFor(topic)
    if (existingSpace) {
      const adopted = await adoptSpaceInto(vaultId, existingSpace)
      if (adopted.ok) {
        const total = adopted.adopted + adopted.skipped
        await patchJob(userId, {
          status: 'ready',
          space: existingSpace,
          openPath: adopted.openPath,
          notesTotal: total,
          // Adopted notes are already drafted — there is no second pass.
          notesDrafted: total,
        })
        void logUsageEvent({ userId, eventType: 'vault_sync', metadata: { adopted: existingSpace, via: 'onboarding' } })
        return
      }
      // Corpus lookup is an optimisation, never a dependency: if the copy
      // fell through (nothing seeded, space vanished between the two reads)
      // generate instead of failing.
    }

    // 2. The plan. This throws with a real, user-facing message — a missing
    //    key reads differently from a malformed response — and the catch below
    //    is what puts that message in front of the user.
    const plan = await generateLearningPlan(topic)

    const space = disambiguateSpace(plan.space, await listUserSpaces(vaultId))
    const titles = plan.subtopics.map((s) => s.title)
    const segments = dedupeSegments(titles)
    const pathOf = (i: number) => `${SPACE_ROOT}${space}/Topics/${segments[i]}.md`
    const openPath = `${SPACE_ROOT}${space}/Next Up.md`

    // Where the plan says to begin, and what Next Up will surface first.
    const firstIdx = Math.max(0, plan.subtopics.findIndex((s) => s.prerequisites.length === 0))

    await patchJob(userId, { space, notesTotal: plan.subtopics.length })

    // 3. Draft the one note they will actually land on before telling them the
    //    space is ready. The rest can arrive behind them, but opening Next Up
    //    and finding every topic still a one-line stub would make "ready" a
    //    lie.
    const apiKey = process.env.GEMINI_API_KEY
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    const placeholders = plan.subtopics.map((s) => buildTopicNote(s.title, s, null, { pending: true }))
    const firstDraft = apiKey
      ? await draftOne(
          apiKey,
          model,
          space,
          {
            path: pathOf(firstIdx),
            title: plan.subtopics[firstIdx].title,
            summary: plan.subtopics[firstIdx].summary,
            placeholder: placeholders[firstIdx],
          },
          titles,
        )
      : null

    // 4. Write the space. One insert, so a user who opens their vault mid-run
    //    never sees a half-built folder.
    const entries = placeholders.map((content, i) => ({
      path: pathOf(i),
      content: i === firstIdx && firstDraft ? firstDraft : content,
    }))
    entries.push({ path: openPath, content: buildNextUpNote(space) })

    await db
      .insert(notes)
      .values(
        entries.map((e) => ({
          vaultId,
          path: e.path,
          content: e.content,
          sizeBytes: Buffer.byteLength(e.content, 'utf8'),
          mtime: new Date(),
        })),
      )
      // A retry of a job that got most of the way through must not collide
      // with what it already wrote.
      .onConflictDoNothing({ target: [notes.vaultId, notes.path] })

    await patchJob(userId, {
      status: 'ready',
      openPath,
      error: null,
      notesDrafted: firstDraft ? 1 : 0,
    })
    void logUsageEvent({ userId, eventType: 'note_write', metadata: { vault: 'personal', space, count: entries.length, source: 'onboarding' } })

    // 5. The rest, behind them. Sequential on purpose: the free tier is
    //    rate-limited per user and five concurrent calls is the fastest way to
    //    trip it. Nobody is waiting, so latency is not the constraint.
    const final = new Map(entries.map((e) => [e.path, e.content]))
    let drafted = firstDraft ? 1 : 0
    if (apiKey) {
      for (let i = 0; i < plan.subtopics.length; i++) {
        if (i === firstIdx) continue
        const path = pathOf(i)
        const content = await draftOne(
          apiKey,
          model,
          space,
          { path, title: plan.subtopics[i].title, summary: plan.subtopics[i].summary, placeholder: placeholders[i] },
          titles,
        )
        // A subtopic whose draft fails keeps its summary-only body. A partial
        // set of drafted notes is strictly better than failing a space that is
        // otherwise complete and valid.
        if (!content) continue
        if (await replaceIfUntouched(vaultId, path, placeholders[i], content)) {
          final.set(path, content)
          drafted++
          await patchJob(userId, { notesDrafted: drafted })
        }
      }
    }

    // 6. Hand the finished drafts to the corpus so the next person asking for
    //    this topic gets step 1 instead of steps 2-5. The client used to do
    //    this and could only contribute what it happened to be holding, which
    //    was never the server-written drafts — so this is the first time the
    //    notes that cost the most to make are the ones being kept.
    await contributeToLibrary([...final].map(([path, content]) => ({ path, content }))).catch((err) =>
      console.warn('[onboarding] library contribution failed (ignored):', err),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[onboarding] run failed', err)
    await patchJob(userId, { status: 'failed', error: message }).catch((e) =>
      console.error('[onboarding] could not even record the failure', e),
    )
  }
}
