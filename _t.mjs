import { Pool } from 'pg'
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const email = 'approval-test@example.invalid'
await p.query(`delete from users where email=$1`, [email])
const u = await p.query(
  `insert into users (google_sub, email, email_verified, display_name, role, access_approved)
   values ($1,$2,true,'Approval Test','user',false) returning id`, ['test-sub-'+Date.now(), email])
const uid = u.rows[0].id
const s = await p.query(
  `insert into sessions (user_id, expires_at) values ($1, now() + interval '1 hour') returning id`, [uid])
console.log('SESSION=' + s.rows[0].id)
console.log('USERID=' + uid)
await p.end()
