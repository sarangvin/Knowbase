// M1 schema: auth + personal cloud vaults. M3 adds api_keys. M4 adds
// subscriptions. M5 adds usage_events.
import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, boolean, timestamp, integer, bigserial, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  // Nullable on purpose: null means "we have never observed a verification
  // claim for this account" (rows created before this column existed), which
  // is a different fact from Google telling us false. Backfilling true would
  // assert something we never actually checked. Rows self-correct on next
  // sign-in, since the OAuth callback writes this on every login.
  emailVerified: boolean('email_verified'),
  // Owner approval — deliberately NOT the same fact as emailVerified above.
  // emailVerified is Google's claim about the address; accessApproved is the
  // owner letting a person in. Defaults false: access is granted, never
  // assumed. Owners bypass it entirely (see requireApproved).
  accessApproved: boolean('access_approved').notNull().default(false),
  accessApprovedAt: timestamp('access_approved_at', { withTimezone: true }),
  // Set when the user asks for access from the landing screen. Kept separate
  // from approval so the admin list can distinguish "waiting on you" from
  // "signed in once and never asked".
  accessRequestedAt: timestamp('access_requested_at', { withTimezone: true }),
  // What they said they wanted to learn, captured on the landing screen
  // before they could possibly know they were not approved yet. Kept so
  // approving someone can start building the thing they asked for, rather
  // than dropping them back on an empty box to type it a third time.
  requestedTopic: text('requested_topic'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('user'), // 'user' | 'owner'
  planTier: text('plan_tier').notNull().default('free'), // 'free' | 'pro', synced from subscriptions in M4
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const vaults = pgTable(
  'vaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }), // null for the global vault (added in M2)
    kind: text('kind').notNull(), // 'personal' | 'global'
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One personal vault per user (v1). The "exactly one global vault" constraint
    // is added in the M2 migration once that row type is actually created.
    uniqueIndex('vaults_owner_personal_unique')
      .on(t.ownerUserId)
      .where(sql`${t.kind} = 'personal'`),
  ],
)

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    mtime: timestamp('mtime', { withTimezone: true }).notNull().defaultNow(),
    sizeBytes: integer('size_bytes').notNull(),
  },
  (t) => [uniqueIndex('notes_vault_path_unique').on(t.vaultId, t.path), index('notes_vault_idx').on(t.vaultId)],
)

// BYO LLM keys. ciphertext/nonce are AES-256-GCM output, base64-encoded (no
// raw bytea column helper in this drizzle-orm version — base64 text is an
// equally safe, simpler fit for values this small). Never selected into any
// API response; only backend/src/llm/* reads ciphertext, to decrypt in memory
// for the duration of a single proxied call.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'anthropic' | ...
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    lastFour: text('last_four').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('api_keys_user_provider_unique').on(t.userId, t.provider)],
)

// Billing. This table is the source of truth for plan state, written only by
// the Razorpay webhook handler (never by the subscribe/cancel routes
// themselves, which only ask Razorpay to start/stop a subscription — the
// webhook is what confirms it actually happened). users.planTier is a
// read-optimized cache kept in sync in the same transaction as this row.
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  razorpayCustomerId: text('razorpay_customer_id').notNull(),
  razorpaySubscriptionId: text('razorpay_subscription_id'),
  status: text('status').notNull().default('created'), // mirrors Razorpay: created|active|halted|cancelled|completed
  planTier: text('plan_tier').notNull().default('free'), // 'free' | 'pro'
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Append-only usage log — every login, vault sync, note write, and LLM call
// across every tier writes one row here, feeding the admin view. bigserial
// (not uuid) since this is the highest-volume table and never referenced by
// other rows via FK.
export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'login' | 'vault_sync' | 'note_write' | 'llm_call'
    provider: text('provider'), // 'anthropic' | 'groq' | 'ollama', nullable for non-llm events
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_events_user_created_idx').on(t.userId, t.createdAt), index('usage_events_type_created_idx').on(t.eventType, t.createdAt)],
)

// Asset *metadata* only for M1 — binary storage backend (S3-compatible bucket,
// keyed by storageKey) is wired up when the app first needs image/PDF upload;
// until then this table exists so the schema/API shape doesn't change later.
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
  },
  (t) => [uniqueIndex('assets_vault_path_unique').on(t.vaultId, t.path)],
)

// M6: one row per user tracking their first-run space generation.
//
// Onboarding used to be synchronous in the browser — the user watched a
// spinner while the plan and the first note were generated. Now the server
// does the whole thing and the user browses the demo space meanwhile, so the
// progress has to live somewhere they can be told about it from: this table
// is what the "your space is ready" notification reads.
//
// Unique on userId rather than append-only: this tracks the one first-run job,
// and a re-run (retry after a failure, or a second topic) replaces it. Keeping
// a history here would mean deciding which row the notification means.
export const onboardingJobs = pgTable(
  'onboarding_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    // 'running' → 'ready' | 'failed'. 'ready' means the notes exist and are
    // navigable, NOT that every draft has landed — notesDrafted/notesTotal
    // carry that, so the user is let in as soon as there is something to see.
    status: text('status').notNull(),
    space: text('space'),
    openPath: text('open_path'),
    /** User-facing message when status is 'failed'. Safe to display verbatim. */
    error: text('error'),
    notesTotal: integer('notes_total').notNull().default(0),
    notesDrafted: integer('notes_drafted').notNull().default(0),
    /** Set once the user has actually been taken to the new space, so the
     *  notification fires once rather than on every load forever. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('onboarding_jobs_user_unique').on(t.userId)],
)

/** The global queue of notes still to be written.
 *
 *  Drafting used to happen inline inside the request that asked for it. That
 *  works right up until it doesn't: a run that exceeds the function's time
 *  limit, or an invocation that gets killed, leaves the note as a one-line
 *  placeholder with nothing anywhere that knows to try again. Three notes in
 *  production sat like that indefinitely before this table existed.
 *
 *  So the work is recorded before it is attempted, and any invocation can
 *  pick up what an earlier one dropped.
 */
export const draftQueue = pgTable(
  'draft_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
    /** The note this job fills in. Unique per vault: one job per note. */
    path: text('path').notNull(),
    space: text('space').notNull(),
    title: text('title').notNull(),
    /** The one-line summary from the plan, which is also what the placeholder
     *  body shows until the draft lands. */
    summary: text('summary').notNull().default(''),
    /** Sibling topic titles, for the prompt's sense of where this note sits. */
    siblings: jsonb('siblings').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 'grow' | 'onboarding' | 'reconcile' — which path created the job. */
    source: text('source').notNull().default('grow'),
    /** 'pending' → 'running' → 'done' | 'failed'. A 'running' row older than
     *  the stale timeout is reclaimed: that is the killed-invocation case. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('draft_queue_vault_path_unique').on(t.vaultId, t.path),
    // The claim query's access path: pending work, oldest first.
    index('draft_queue_status_created_idx').on(t.status, t.createdAt),
  ],
)

/** One quiz per user per day.
 *
 *  The row is the whole quiz: the questions as asked, the options as shown,
 *  which one is right, and what the user picked. Storing the generated
 *  options rather than regenerating them means reopening the tab resumes the
 *  same quiz instead of quietly producing a different one, and the daily cap
 *  is a unique index rather than something the client is trusted to enforce.
 */
export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Local YYYY-MM-DD, supplied by the client — the same day the review
     *  cap uses, so "one a day" means one calendar day where the user is,
     *  not where the database is. */
    day: text('day').notNull(),
    /** [{ notePath, noteTitle, question, options[4], answer, chosen }] */
    questions: jsonb('questions').$type<QuizQuestionRow[]>().notNull(),
    score: integer('score').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('quizzes_user_day_unique').on(t.userId, t.day)],
)

export interface QuizQuestionRow {
  notePath: string
  noteTitle: string
  question: string
  options: string[]
  /** Index into options. Never sent to the client before they answer. */
  answer: number
  /** Index into options, or null while unanswered. */
  chosen: number | null
}

/** One deck of flashcards per user per day.
 *
 *  Same shape and same reasoning as `quizzes`: the row is the whole deck, so
 *  reopening the tab shows the cards you were given rather than quietly
 *  dealing a new hand, and the daily limit is a unique index rather than
 *  something the client is trusted to honour. Which side each card opens on
 *  is stored too — a card that flips to a different face on reload is a
 *  different card.
 */
export const flashcardDecks = pgTable(
  'flashcard_decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Local YYYY-MM-DD from the client, like the quiz and the review cap. */
    day: text('day').notNull(),
    /** [{ notePath, noteTitle, term, definition, front }] */
    cards: jsonb('cards').$type<FlashcardRow[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('flashcard_decks_user_day_unique').on(t.userId, t.day)],
)

export interface FlashcardRow {
  notePath: string
  noteTitle: string
  term: string
  definition: string
  /** Which face is shown before the first tap. Decided when the deck is
   *  dealt, not at render time, so it survives a reload. */
  front: 'term' | 'definition'
}
