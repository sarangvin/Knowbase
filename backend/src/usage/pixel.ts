// Anonymous funnel checkpoints, shown in the admin Funnel tab.
//
// Each checkpoint is a counter per hour in `pixels` — a name and a number,
// nothing about who. That is what lets the same table count both halves of
// sign-up: before Google there is no account to attach anything to, after it
// there is, and a funnel that only exists on one side of that line cannot
// show the drop across it.
//
// Best-effort, like logUsageEvent: the write happens after the response and a
// failure is logged and dropped, never surfaced to the request it describes.
import { waitUntil } from '@vercel/functions'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

/** Fired by the server, where the event happens. */
export const SERVER_PIXELS = [
  'oauth_new_account',
  'oauth_returning',
  'oauth_failed',
  'onboarding_start',
  'onboarding_ready',
  'onboarding_failed',
  'vault_created',
  'note_completed',
  'note_not_interested',
  'note_swipe_undo',
  'quiz_completed',
  'flashcards_completed',
] as const

/** Fired by the browser through POST /api/pixel/:name — the only ones that
 *  endpoint accepts. Anything before sign-in has to be one of these. */
export const CLIENT_PIXELS = [
  'landing_view',
  'landing_view_signed_in',
  'signup_click',
  'login_click',
  'note_swipe_left',
  'email_click_ready',
  'email_click_next',
  'preview_view',
  'preview_signup_click',
] as const

export type PixelName = (typeof SERVER_PIXELS)[number] | (typeof CLIENT_PIXELS)[number]

const KEEP_DAYS = 30

export function firePixel(name: PixelName): void {
  const p = (async () => {
    await db.execute(sql`
      INSERT INTO pixels (hour, name, count)
      VALUES (date_trunc('hour', now()), ${name}, 1)
      ON CONFLICT (hour, name) DO UPDATE SET count = pixels.count + 1
    `)
    // Housekeeping on roughly one write in fifty, so it costs nothing per request.
    if (Math.random() < 0.02) {
      await db.execute(sql`DELETE FROM pixels WHERE hour < now() - make_interval(days => ${KEEP_DAYS})`)
    }
  })().catch((err) => console.error('[pixel] write failed', name, err))
  waitUntil(p)
}
