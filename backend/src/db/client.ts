import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'
import { withStrictSsl } from './connectionString.js'

// Vercel Postgres injects POSTGRES_URL; a self-hosted/local setup sets
// DATABASE_URL. Accept either so the same code runs in both.
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!connectionString) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set')

// This URL must be the POOLED one. Each warm serverless instance keeps its own
// Pool, and there can be many at once, so the pooler (PgBouncer in front of
// Postgres) is what stops us exhausting connections — and max:1 stops a single
// instance holding several. On a long-running server this is simply a small
// pool, which is fine for this workload.
export const pool = new Pool({ connectionString: withStrictSsl(connectionString), max: 1 })
// Neon closes connections that sit idle, and the pool reports that as an
// 'error' event on the idle client. Unhandled, an 'error' event ends the
// process — which is how an hour-long backfill died on ECONNRESET between
// two queries. The pool already drops the broken client and opens a new one
// on the next query; this only has to stop the event being fatal.
pool.on('error', (err) => {
  console.warn('[db] idle connection closed:', err.message)
})
export const db = drizzle(pool, { schema })
