// M1 schema: auth + personal cloud vaults. M3 adds api_keys. M4 adds
// subscriptions. M5 adds usage_events.
import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, integer, bigserial, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
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
