import { Pool } from 'pg'
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const o = await p.query(`select id from users where role='owner' limit 1`)
const s = await p.query(`insert into sessions (user_id, expires_at) values ($1, now() + interval '10 minutes') returning id`, [o.rows[0].id])
console.log('S=' + s.rows[0].id)
await p.end()
