import { makePool } from './_pool.mjs'
const p = await makePool()
await p.query(`delete from users where email='reset-test@example.invalid'`)
const u = (await p.query(`insert into users (google_sub,email,role,access_approved,last_login_at)
  values ($1,'reset-test@example.invalid','user',true,now()) returning id`, ['reset-'+Date.now()])).rows[0]
const v = (await p.query(`insert into vaults (owner_user_id,kind,name) values ($1,'personal','My Vault') returning id`, [u.id])).rows[0]
for (const path of ['Automated Graph/Test/Next Up.md','Automated Graph/Test/Topics/A.md','Automated Graph/Test/Topics/B.md'])
  await p.query(`insert into notes (vault_id,path,content,size_bytes) values ($1,$2,'x',1)`, [v.id, path])
await p.query(`insert into onboarding_jobs (user_id,topic,status) values ($1,'Test','ready')`, [u.id])
const s = (await p.query(`insert into sessions (user_id,expires_at) values ($1, now()+interval '20 minutes') returning id`, [u.id])).rows[0]
console.log('SESSION=' + s.id)
console.log('before -> notes:', (await p.query(`select count(*)::int c from notes where vault_id=$1`,[v.id])).rows[0].c,
            '| jobs:', (await p.query(`select count(*)::int c from onboarding_jobs where user_id=$1`,[u.id])).rows[0].c,
            '| global notes:', (await p.query(`select count(*)::int c from notes n join vaults v on v.id=n.vault_id where v.kind='global'`)).rows[0].c)
await p.end()
