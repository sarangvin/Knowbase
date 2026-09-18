import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { withStrictSsl } from './connectionString.js'

// Migrations deliberately do NOT reuse db/client.ts. That one points at the
// pooled URL, and DDL through PgBouncer's transaction pooling misbehaves
// (prepared statements, session state). Vercel Postgres exposes the direct
// endpoint as POSTGRES_URL_NON_POOLING / DATABASE_URL_UNPOOLED; fall back to
// the plain URL for a local Postgres, which has no pooler in front of it.
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL

if (!connectionString) throw new Error('No database URL set for migrations')

const pool = new Pool({ connectionString: withStrictSsl(connectionString), max: 1 })
await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
await pool.end()
console.log('Migrations applied.')
