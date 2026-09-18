import { Pool } from 'pg'
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
// Owner session, to call the admin approve endpoint as the owner would.
const o = await p.query(`select id from users where role='owner' limit 1`)
const s = await p.query(`insert into sessions (user_id, expires_at) values ($1, now() + interval '1 hour') returning id`, [o.rows[0].id])
console.log('OWNER_SESSION=' + s.rows[0].id)
console.log('OWNER_ID=' + o.rows[0].id)
await p.end()
